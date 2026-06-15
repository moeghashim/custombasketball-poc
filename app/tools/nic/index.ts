import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { callKimiJson } from "../../shared/ai.js";
import { postSigned } from "../../shared/signing.js";
import type { FlowEvent, JobRequest, ToolResult } from "../../shared/types.js";

interface NicData {
  url: string;
  project?: string;
  service?: string;
}

interface SiteJersey {
  name: string;
  design: string;
  price: number;
}

interface SiteBuild {
  html: string;
  css: string;
  jerseys: SiteJersey[];
  model: string;
}

interface KimiSiteResponse {
  html: string;
  css: string;
  jerseys: SiteJersey[];
}

const execFileAsync = promisify(execFile);
const LIVE_TIMEOUT_MS = 180_000;

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const brief = parseBrief();
  const secret = requiredEnv("JOB_HMAC_SECRET");
  const send = async (event: FlowEvent) => emit(brief, secret, { event });

  await send({ event: "activate", step: "build" });
  await send({ event: "log", step: "build", kind: "cmd", text: "nic build --store custombasketball" });
  await send({ event: "log", step: "build", kind: "dim", text: "asking Kimi K2.7 Code to generate the storefront" });

  const site = await buildStorefrontWithKimi(brief.brief);
  const project = railwayProjectName(brief.job_id);
  const workDir = await mkdtemp(path.join(os.tmpdir(), `nic-${project}-`));
  const appDir = path.join(workDir, "app");

  await send({ event: "progress", step: "build", n: 1 });
  await send({ event: "log", step: "build", kind: "ok", text: `${site.jerseys.length} custom jerseys modeled by ${site.model}` });
  await send({ event: "progress", step: "build", n: 2 });
  await send({ event: "log", step: "build", kind: "dim", text: "writing responsive HTML/CSS bundle to Railway app" });

  try {
    await writeRailwayApp(appDir, site);
    await send({ event: "progress", step: "build", n: 3 });
    await send({ event: "log", step: "build", kind: "arr", text: `creating Railway deployment ${project}` });

    await send({ event: "progress", step: "build", n: 4 });
    await send({ event: "log", step: "build", kind: "arr", text: "deploying generated site to Railway" });

    const deployment = await deployRailwaySite(appDir, project);
    await send({ event: "data", step: "build", patch: { url: deployment.url } });
    await send({ event: "log", step: "build", kind: "ok", text: `live · ${deployment.url}` });
    await send({ event: "progress", step: "build", n: 5 });
    await send({ event: "complete", step: "build" });

    const result: ToolResult<NicData> = {
      ok: true,
      tool: "nic",
      command: "build",
      data: { url: deployment.url, project: deployment.project, service: deployment.service },
      error: null,
      meta: {
        product_count: site.jerseys.length,
        host: "railway",
        generated_at: new Date().toISOString(),
      },
    };
    await emit(brief, secret, { result });
  } finally {
    await rm(workDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function emit(
  brief: JobRequest,
  secret: string,
  payload: { event?: FlowEvent; result?: ToolResult<NicData> },
): Promise<void> {
  const envelope = { job_id: brief.job_id, ...payload };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  await postSigned(brief.callback_url, secret, envelope);
}

async function writeRailwayApp(appDir: string, site: SiteBuild): Promise<void> {
  const publicDir = path.join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "index.html"), site.html);
  await writeFile(path.join(publicDir, "styles.css"), site.css);
  await writeFile(path.join(publicDir, "robots.txt"), "User-agent: *\nAllow: /\n");
  await writeFile(
    path.join(appDir, "package.json"),
    `${JSON.stringify({ type: "module", engines: { node: "20.x" }, scripts: { start: "node server.js" } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(appDir, "server.js"),
    `import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const root = join(process.cwd(), "public");
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const safePath = normalize(pathname).replace(/^(\\.\\.[/\\\\])+/, "");
  const filePath = join(root, safePath === "/" ? "index.html" : safePath);
  const target = existsSync(filePath) ? filePath : join(root, "index.html");
  res.setHeader("content-type", types.get(extname(target)) || "application/octet-stream");
  createReadStream(target).pipe(res);
}).listen(Number(process.env.PORT || 3000), "0.0.0.0");
`,
  );
}

async function deployRailwaySite(cwd: string, project: string): Promise<{ url: string; project: string; service?: string }> {
  const configuredProject = optionalEnv(["RAILWAY_PROJECT_ID", "GENERATED_SITE_HOST_PROJECT_ID"]);
  const configuredService = optionalEnv(["RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "GENERATED_SITE_HOST_SERVICE_ID"]);
  const configuredEnvironment = optionalEnv(["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_ID", "GENERATED_SITE_HOST_ENVIRONMENT_ID"]);
  let createdService: string | undefined;

  if (!configuredProject && !process.env.RAILWAY_TOKEN) {
    const initArgs = ["init", "--name", project, "--json"];
    const workspace = optionalEnv(["RAILWAY_WORKSPACE", "RAILWAY_WORKSPACE_ID", "GENERATED_SITE_HOST_WORKSPACE_ID"]);
    if (workspace) initArgs.push("--workspace", workspace);
    await runRailway(initArgs, cwd);
    await runRailway(["add", "--service", project, "--json"], cwd);
    createdService = project;
  }

  const deployArgs = ["up", "--detach", "--json", "--yes", "--message", `custombasketball ${project}`];
  const deployService = configuredService || createdService;
  if (configuredProject) deployArgs.push("--project", configuredProject);
  if (configuredEnvironment) deployArgs.push("--environment", configuredEnvironment);
  if (deployService) deployArgs.push("--service", deployService);
  const deployOutput = await runRailway(deployArgs, cwd);

  const service = deployService || (await firstRailwayService(cwd));
  const url =
    findRailwayUrl(deployOutput) ||
    (await ensureRailwayDomain(cwd, undefined, configuredProject, configuredEnvironment)) ||
    (service ? await ensureRailwayDomain(cwd, service, configuredProject, configuredEnvironment) : null) ||
    (service !== project ? await ensureRailwayDomain(cwd, project, configuredProject, configuredEnvironment) : null) ||
    findRailwayUrl(await runRailway(["status", "--json"], cwd));

  if (!url) throw new Error("Railway did not return or expose a public deployment URL");
  if (await waitForLiveUrl(url)) return { url, project: configuredProject || project, service };

  throw new Error(`Railway deployment did not become live within ${LIVE_TIMEOUT_MS / 1000}s`);
}

async function firstRailwayService(cwd: string): Promise<string | undefined> {
  const output = await runRailway(["service", "list", "--json"], cwd);
  const parsed = parseJsonPayloads(output);
  const services = parsed.flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    if (entry && typeof entry === "object" && Array.isArray((entry as { services?: unknown[] }).services)) {
      return (entry as { services: unknown[] }).services;
    }
    return [];
  });
  const service = services.find((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  const id = service?.id || service?.serviceId || service?.name;
  return typeof id === "string" ? id : undefined;
}

async function ensureRailwayDomain(
  cwd: string,
  service: string | undefined,
  project: string | undefined,
  environment: string | undefined,
): Promise<string | null> {
  const args = ["domain", "--json"];
  if (service) args.push("--service", service);
  if (project) args.push("--project", project);
  if (environment) args.push("--environment", environment);
  try {
    return findRailwayUrl(await runRailway(args, cwd));
  } catch (error) {
    const existing = findRailwayUrl(commandErrorText(error));
    if (existing) return existing;
    return null;
  }
}

async function runRailway(args: string[], cwd: string): Promise<string> {
  const env = {
    ...process.env,
    CI: "true",
    RAILWAY_API_TOKEN: optionalEnv(["RAILWAY_API_TOKEN", "GENERATED_SITE_HOST_RAILWAY_API_TOKEN", "GENERATED_SITE_HOST_API_TOKEN"]),
    RAILWAY_TOKEN: optionalEnv(["RAILWAY_TOKEN", "GENERATED_SITE_HOST_RAILWAY_TOKEN", "GENERATED_SITE_HOST_TOKEN"]),
  };
  if (!env.RAILWAY_API_TOKEN && !env.RAILWAY_TOKEN) {
    throw new Error("RAILWAY_API_TOKEN or RAILWAY_TOKEN is required");
  }
  const result = await execFileAsync("railway", args, { cwd, env, maxBuffer: 1024 * 1024 * 10 });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function waitForLiveUrl(url: string): Promise<boolean> {
  const deadline = Date.now() + LIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET", redirect: "follow" });
      if (response.status === 200) return true;
    } catch {
      // Railway domains can take a few seconds to route to the fresh deployment.
    }
    await delay(1500);
  }
  return false;
}

function railwayProjectName(jobId: string): string {
  const suffix = jobId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return suffix ? `cb${suffix}` : "cbsite";
}

function findRailwayUrl(output: string): string | null {
  const railwayDomain = output.match(/https:\/\/[a-z0-9-]+(?:\.up)?\.railway\.app|[a-z0-9-]+(?:\.up)?\.railway\.app/i);
  if (railwayDomain) return railwayDomain[0].startsWith("http") ? railwayDomain[0] : `https://${railwayDomain[0]}`;

  for (const payload of parseJsonPayloads(output)) {
    const fromJson = findUrlInJson(payload);
    if (fromJson) return fromJson;
  }
  return null;
}

function parseJsonPayloads(output: string): unknown[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function findUrlInJson(value: unknown): string | null {
  if (typeof value === "string") {
    return value.match(/^https:\/\/[a-z0-9-]+(?:\.up)?\.railway\.app$/i) || value.match(/^[a-z0-9-]+(?:\.up)?\.railway\.app$/i)
      ? value.startsWith("http")
        ? value
        : `https://${value}`
      : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findUrlInJson(item);
      if (url) return url;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "domain", "publicDomain", "serviceDomain"]) {
      const url = findUrlInJson(record[key]);
      if (url) return url;
    }
    for (const item of Object.values(record)) {
      const url = findUrlInJson(item);
      if (url) return url;
    }
  }
  return null;
}

function optionalEnv(names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find(Boolean);
}

function commandErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const maybe = error as { message?: string; stdout?: string; stderr?: string };
  return [maybe.message, maybe.stdout, maybe.stderr].filter(Boolean).join("\n");
}

async function buildStorefrontWithKimi(brief: Record<string, unknown>): Promise<SiteBuild> {
  const response = await callKimiJson<KimiSiteResponse>({
    system:
      "You are Nic, a senior frontend builder. Return only valid JSON. Generate production-ready static HTML and CSS for a small ecommerce landing page.",
    user: JSON.stringify({
      task: "Generate a complete custombasketball website.",
      brand: brief.brand || "custombasketball",
      product_count: brief.product_count || 5,
      requirements: [
        "Exactly 5 custom basketball jersey products.",
        "HTML must be a full document with doctype, html lang, title, meta description, viewport, semantic header/nav/main/sections, accessible links, and no script tags.",
        "CSS must be separate and assume the HTML links to ./styles.css.",
        "Use no external images, fonts, scripts, stylesheets, or network assets.",
        "Make the design polished, responsive, and suitable for a team-uniform storefront.",
        "Use real visible product names, descriptions, prices, and a clear quote CTA.",
      ],
      output_shape: {
        html: "full HTML document string",
        css: "complete CSS string",
        jerseys: [{ name: "string", design: "string", price: 89 }],
      },
    }),
    temperature: 0.45,
    maxTokens: 9000,
  });

  const site = validateSite(response.data);
  return { ...site, model: response.model };
}

function validateSite(site: KimiSiteResponse): Omit<SiteBuild, "model"> {
  if (!site || typeof site !== "object") throw new Error("Kimi did not return a site object");
  const html = normalizeGeneratedHtml(site.html);
  const css = typeof site.css === "string" ? site.css.trim() : "";
  const jerseys = Array.isArray(site.jerseys) ? site.jerseys.filter(isJersey).slice(0, 5) : [];

  if (!html.includes("<!doctype html") && !html.includes("<!DOCTYPE html")) throw new Error("Kimi HTML is missing a doctype");
  if (!/<html[\s>]/i.test(html)) throw new Error("Kimi HTML is missing an html element");
  if (/<script[\s>]/i.test(html)) throw new Error("Kimi HTML must not contain scripts");
  if (css.length < 800) throw new Error("Kimi CSS was too small to be a complete design");
  if (jerseys.length !== 5) throw new Error("Kimi must return exactly 5 jersey products");

  return { html, css, jerseys };
}

function normalizeGeneratedHtml(value: unknown): string {
  let html = typeof value === "string" ? value.trim() : "";
  if (!html) throw new Error("Kimi HTML was empty");
  if (!/<link[^>]+href=["']\.\/styles\.css["']/i.test(html) && /<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="./styles.css">\n</head>');
  }
  return html;
}

function isJersey(value: unknown): value is SiteJersey {
  if (!value || typeof value !== "object") return false;
  const jersey = value as Partial<SiteJersey>;
  return typeof jersey.name === "string" && typeof jersey.design === "string" && typeof jersey.price === "number";
}

function parseBrief(): JobRequest {
  const raw = flagValue("--brief");
  return JSON.parse(raw) as JobRequest;
}

function flagValue(name: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
