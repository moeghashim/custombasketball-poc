import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callOpenAIJson } from "../shared/ai.js";
import { createJob, getJob, hasDatabaseConfig, insertResult, migrate, updateJobStatus, waitForTerminalJob } from "./db.js";
import { normalizeRuntimeEnv } from "./runtime-env.js";
import { addSseClient, broadcastFlow } from "./sse.js";
import { installWebhook } from "./webhook.js";
import type { AgentName, JobRecord, StageId } from "../shared/types.js";

interface MaestroEvaluation {
  decision: "approve" | "revise" | "reject";
  safe_to_execute: boolean;
  summary: string;
  concerns: string[];
  accepted_changes: number;
  required_followups: string[];
}

normalizeRuntimeEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const webRoot = path.join(appRoot, "web");

let databaseReady = false;
let databaseError: string | null = null;

const app = express();

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

installWebhook(app);

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    database: {
      configured: hasDatabaseConfig(),
      ready: databaseReady,
      error: databaseError,
    },
  }),
);

app.get("/api/events", (req, res) => {
  const cleanup = addSseClient(res);
  req.on("close", cleanup);
});

app.post("/api/run", async (req, res) => {
  if (!databaseReady) {
    res.status(503).json({
      ok: false,
      error: databaseError || "Database is not ready; set DATABASE_URL or NEON_CONNECTION_STRING in Render.",
    });
    return;
  }

  const runId = randomUUID();
  const baseUrl = publicBaseUrl(req);
  res.json({ ok: true, run_id: runId });

  setTimeout(() => {
    orchestrateRun(runId, baseUrl).catch((error) => {
      console.error(error);
      broadcastFlow({ event: "error", step: "system", text: error.message, run_id: runId });
    });
  }, 250);
});

app.get("/", (_req, res) => sendIndex(res));
app.use(express.static(webRoot, { index: false }));
app.use((_req, res) => sendIndex(res));

migrate()
  .then(() => {
    databaseReady = true;
    databaseError = null;
  })
  .catch((error) => {
    databaseReady = false;
    databaseError = error instanceof Error ? error.message : String(error);
    console.error(`Database migration failed: ${databaseError}`);
  });

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Maestro listening on ${port}`);
});

function publicBaseUrl(req: express.Request): string {
  const configured = process.env.MAESTRO_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function sendIndex(res: express.Response): void {
  res.setHeader("cache-control", "no-store");
  res.sendFile(path.join(webRoot, "index.html"));
}

function pauseForVisibleHandoff(): Promise<void> {
  const delayMs = Number(process.env.STEP_HANDOFF_PAUSE_MS || 3000);
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

async function orchestrateRun(runId: string, baseUrl: string): Promise<void> {
  broadcastFlow({ event: "activate", step: "build", run_id: runId });

  const nic = await createJob({
    runId,
    agent: "nic",
    task: "build",
    callbackUrl: `${baseUrl}/api/jobs/__JOB_ID__/ingest`,
    brief: {
      brand: "custombasketball",
      product_count: 5,
      deployment: "railway",
    },
  });
  nic.input.callback_url = `${baseUrl}/api/jobs/${nic.id}/ingest`;
  await dispatchOrFail(nic);

  const nicDone = await waitForTerminalJob(nic.id);
  await cleanupSandbox(nicDone).catch((error) => console.warn(`cleanup failed for ${nic.id}:`, error));
  if (nicDone.status !== "succeeded" || !nicDone.output?.data || typeof nicDone.output.data !== "object") {
    throw new Error(nicDone.error || "Nic failed without a usable result");
  }

  const siteUrl = (nicDone.output.data as { url?: string }).url;
  if (!siteUrl) throw new Error("Nic result did not include a generated-site URL");

  await pauseForVisibleHandoff();
  broadcastFlow({ event: "activate", step: "report", run_id: runId });

  const max = await createJob({
    runId,
    agent: "max",
    task: "audit",
    callbackUrl: `${baseUrl}/api/jobs/__JOB_ID__/ingest`,
    brief: { url: siteUrl },
  });
  max.input.callback_url = `${baseUrl}/api/jobs/${max.id}/ingest`;
  await dispatchOrFail(max);

  const maxDone = await waitForTerminalJob(max.id);
  await cleanupSandbox(maxDone).catch((error) => console.warn(`cleanup failed for ${max.id}:`, error));
  if (maxDone.status !== "succeeded") {
    throw new Error(maxDone.error || "Max failed without a usable result");
  }

  const evaluation = await evaluateMaxProposal(siteUrl, maxDone.output?.data);
  await insertResult(max.id, "event", { event: "maestro_evaluation", payload: evaluation });
  broadcastFlow({
    event: "data",
    step: "report",
    patch: {
      maestroEvaluation: evaluation.summary,
      meta: ["Evaluated by Maestro", evaluation.decision, evaluation.safe_to_execute ? "Safe to execute" : "Needs revision"],
    },
    run_id: runId,
  });

  broadcastFlow({
    event: "ack",
    step: "report",
    text: `Maestro evaluated Max's proposal with ${process.env.OPENAI_MODEL || "gpt-5.5"} (${process.env.OPENAI_REASONING_EFFORT || "high"}) and decided: ${evaluation.decision}. ${evaluation.summary}`,
    run_id: runId,
  });
}

async function dispatchOrFail(job: JobRecord): Promise<void> {
  try {
    await dispatchJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJobStatus(job.id, "failed", { error: message });
    throw error;
  }
}

async function dispatchJob(job: JobRecord): Promise<void> {
  const image = requiredEnv("BLAXEL_SANDBOX_IMAGE");
  const sandboxName = `custombasketball-${job.agent}-${job.id.slice(0, 8)}`;
  await updateJobStatus(job.id, "dispatched", { sandboxName });

  const { SandboxInstance } = await import("@blaxel/core");
  const sandbox = await SandboxInstance.createIfNotExists({
    name: sandboxName,
    image,
    memory: 4096,
    region: process.env.BL_REGION || "us-pdx-1",
    labels: {
      app: "custombasketball-poc",
      run_id: job.run_id,
      job_id: job.id,
      agent: job.agent,
    },
  });

  const command = commandFor(job.agent, job.task, {
    ...job.input,
    callback_url: `${job.input.callback_url}`.replace("__JOB_ID__", job.id),
  });

  const envPrefix = [
    `JOB_HMAC_SECRET=${shellQuote(job.hmac_secret)}`,
    ...envForJob(job.agent),
  ]
    .filter(Boolean)
    .join(" ");

  const processResult = await sandbox.process.exec({
    name: `job-${job.id}`,
    command: `${envPrefix} ${command}`,
    waitForCompletion: true,
    timeout: 10 * 60 * 1000,
  });
  assertProcessSucceeded(processResult);
}

async function cleanupSandbox(job: JobRecord): Promise<void> {
  if (!job.sandbox_name) return;
  const { SandboxInstance } = await import("@blaxel/core");
  const sandbox = await SandboxInstance.get(job.sandbox_name);
  if (typeof sandbox.delete === "function") {
    await sandbox.delete();
  }
}

function commandFor(agent: AgentName, task: string, request: Record<string, unknown>): string {
  const binary = agent === "nic" ? "nic" : "max";
  return `${binary} ${task} --brief ${shellQuote(JSON.stringify(request))}`;
}

function envForJob(agent: AgentName): string[] {
  const keys = Object.keys(process.env).filter((key) => {
    if (/^(KIMI|MOONSHOT)_/.test(key)) return true;
    return agent === "nic" && /^(RAILWAY|GENERATED_SITE_HOST)_/.test(key);
  });
  if (agent === "nic" && !keys.some((key) => /^RAILWAY_(API_)?TOKEN$/.test(key) || /^GENERATED_SITE_HOST_.*TOKEN$/.test(key))) {
    throw new Error("RAILWAY_API_TOKEN or RAILWAY_TOKEN is required");
  }
  if (!keys.some((key) => /^(KIMI_API_KEY|MOONSHOT_API_KEY)$/.test(key))) {
    throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY is required");
  }
  return keys.map((key) => `${key}=${shellQuote(requiredEnv(key))}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertProcessSucceeded(result: Record<string, unknown>): void {
  const rawExitCode = result.exitCode ?? result.exit_code;
  const exitCode = typeof rawExitCode === "number" ? rawExitCode : null;
  if (exitCode === null || exitCode === 0) return;

  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const detail = stderr || stdout || `exit code ${exitCode}`;
  throw new Error(`Sandbox process failed: ${detail}`);
}

async function evaluateMaxProposal(siteUrl: string, maxData: unknown): Promise<MaestroEvaluation> {
  const response = await callOpenAIJson<MaestroEvaluation>({
    system:
      "You are Maestro, a careful orchestrator reviewing an SEO/code proposal from a specialist. Return only valid JSON. Evaluate whether the proposed changes are safe, scoped, and useful for the generated website.",
    user: JSON.stringify({
      site_url: siteUrl,
      max_result: maxData,
      policy: [
        "Approve only low-risk changes that stay inside static SEO/content files.",
        "Reject or revise changes that require secrets, new services, tracking scripts, external assets, destructive actions, or unclear targets.",
        "Do not rewrite the proposal. Evaluate it and state what Maestro would do next.",
      ],
    }),
    schema: {
      name: "maestro_seo_evaluation",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "safe_to_execute", "summary", "concerns", "accepted_changes", "required_followups"],
        properties: {
          decision: { type: "string", enum: ["approve", "revise", "reject"] },
          safe_to_execute: { type: "boolean" },
          summary: { type: "string" },
          concerns: { type: "array", items: { type: "string" } },
          accepted_changes: { type: "number" },
          required_followups: { type: "array", items: { type: "string" } },
        },
      },
    },
  });
  return validateEvaluation(response.data);
}

function validateEvaluation(value: MaestroEvaluation): MaestroEvaluation {
  if (!value || typeof value !== "object") throw new Error("Maestro model did not return an evaluation object");
  const decision = value.decision === "approve" || value.decision === "reject" || value.decision === "revise" ? value.decision : "revise";
  const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : "Maestro could not summarize the proposal.";
  return {
    decision,
    safe_to_execute: Boolean(value.safe_to_execute),
    summary,
    concerns: Array.isArray(value.concerns) ? value.concerns.filter((item): item is string => typeof item === "string") : [],
    accepted_changes: typeof value.accepted_changes === "number" ? value.accepted_changes : 0,
    required_followups: Array.isArray(value.required_followups)
      ? value.required_followups.filter((item): item is string => typeof item === "string")
      : [],
  };
}
