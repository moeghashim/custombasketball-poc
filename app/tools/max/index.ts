import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { callKimiJson } from "../../shared/ai.js";
import { postSigned } from "../../shared/signing.js";
import type { FlowEvent, JobRequest, ToolResult } from "../../shared/types.js";

interface Finding {
  id: string;
  title: string;
  score: number | null;
  description: string;
}

interface MaxData {
  seo_score: number;
  findings: Finding[];
  suggestions: string[];
  proposal: SeoProposal;
}

interface SeoProposal {
  summary: string;
  suggestions: string[];
  changes: SeoChange[];
  risk: "low" | "medium" | "high";
}

interface SeoChange {
  file: "public/index.html" | "public/styles.css" | "public/robots.txt";
  operation: "replace" | "append" | "create";
  target?: string;
  value: string;
  rationale: string;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const brief = parseBrief();
  const secret = requiredEnv("JOB_HMAC_SECRET");
  const url = String(brief.brief.url || "");
  if (!url) throw new Error("Max requires brief.url");

  const send = async (event: FlowEvent) => emit(brief, secret, { event });
  await send({ event: "activate", step: "report" });
  await send({ event: "data", step: "report", patch: emptyReportData(url) });
  await send({ event: "progress", step: "report", n: 1 });
  await send({ event: "log", step: "report", kind: "cmd", text: `max audit ${url}` });

  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH || process.env.CHROME_BIN,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    await send({ event: "progress", step: "report", n: 2 });
    const runner = await lighthouse(
      url,
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["seo"],
      },
      undefined,
    );

    if (!runner?.lhr) throw new Error("Lighthouse did not return a report");

    const seoScore = Math.round((runner.lhr.categories.seo?.score ?? 0) * 100);
    const findings = collectFindings(runner.lhr.audits);
    await send({ event: "log", step: "report", kind: "arr", text: "Kimi K2.7 Code drafting SEO change proposal" });
    const snapshot = await fetchSiteSnapshot(url);
    const proposal = await proposeSeoChanges(url, seoScore, findings, snapshot);
    const data: MaxData = { seo_score: seoScore, findings, suggestions: proposal.suggestions, proposal };

    await send({
      event: "data",
      step: "report",
      patch: reportData(url, data),
    });
    await send({ event: "progress", step: "report", n: 3 });
    await send({ event: "progress", step: "report", n: 4 });
    await send({ event: "progress", step: "report", n: 5 });
    await send({ event: "complete", step: "report" });

    const result: ToolResult<MaxData> = {
      ok: true,
      tool: "max",
      command: "audit",
      data,
      error: null,
      meta: {
        lighthouse_version: runner.lhr.lighthouseVersion,
        final_url: runner.lhr.finalDisplayedUrl || runner.lhr.finalUrl,
        kimi_model: process.env.KIMI_MODEL || "kimi-k2.7-code",
        generated_at: new Date().toISOString(),
      },
    };
    await emit(brief, secret, { result });
  } finally {
    await chrome.kill();
  }
}

async function emit(
  brief: JobRequest,
  secret: string,
  payload: { event?: FlowEvent; result?: ToolResult<MaxData> },
): Promise<void> {
  const envelope = { job_id: brief.job_id, ...payload };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  await postSigned(brief.callback_url, secret, envelope);
}

function collectFindings(audits: Record<string, any>): Finding[] {
  return Object.entries(audits)
    .filter(([, audit]) => {
      if (audit.score === null || audit.scoreDisplayMode === "notApplicable") return false;
      return typeof audit.score === "number" && audit.score < 1;
    })
    .slice(0, 6)
    .map(([id, audit]) => ({
      id,
      title: audit.title,
      score: audit.score,
      description: stripMarkup(audit.description || ""),
    }));
}

async function proposeSeoChanges(url: string, seoScore: number, findings: Finding[], html: string): Promise<SeoProposal> {
  const response = await callKimiJson<SeoProposal>({
    system:
      "You are Max, an SEO/code specialist. Return only valid JSON. Propose safe, minimal changes for a static HTML/CSS website from Lighthouse SEO facts.",
    user: JSON.stringify({
      url,
      seo_score: seoScore,
      findings,
      html: html.slice(0, 35_000),
      allowed_files: ["public/index.html", "public/styles.css", "public/robots.txt"],
      output_shape: {
        summary: "short plain-English summary",
        suggestions: ["specific suggested SEO improvements"],
        changes: [
          {
            file: "public/index.html",
            operation: "replace | append | create",
            target: "exact existing text for replace, optional for append/create",
            value: "replacement or content to add",
            rationale: "why this improves SEO",
          },
        ],
        risk: "low | medium | high",
      },
      rules: [
        "Only suggest changes in allowed_files.",
        "Prefer low-risk metadata, crawlability, canonical, structured data, robots.txt, and accessible content changes.",
        "Do not propose JavaScript, external tracking, third-party assets, or server changes.",
        "If Lighthouse found no failures, propose 1-2 optional low-risk improvements and set risk to low.",
        "Return 1 to 5 suggestions and at most 5 changes.",
      ],
    }),
    temperature: 0.2,
    maxTokens: 5000,
  });
  return validateProposal(response.data);
}

async function fetchSiteSnapshot(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch generated site for SEO proposal: ${response.status}`);
  return response.text();
}

function validateProposal(proposal: SeoProposal): SeoProposal {
  if (!proposal || typeof proposal !== "object") throw new Error("Kimi did not return an SEO proposal object");
  const summary = typeof proposal.summary === "string" ? proposal.summary.trim() : "";
  const suggestions = Array.isArray(proposal.suggestions)
    ? proposal.suggestions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
    : [];
  const changes = Array.isArray(proposal.changes) ? proposal.changes.filter(isSeoChange).slice(0, 5) : [];
  const risk = proposal.risk === "medium" || proposal.risk === "high" ? proposal.risk : "low";

  if (!summary) throw new Error("Kimi SEO proposal is missing a summary");
  if (!suggestions.length) throw new Error("Kimi SEO proposal is missing suggestions");
  return { summary, suggestions, changes, risk };
}

function isSeoChange(value: unknown): value is SeoChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Partial<SeoChange>;
  return (
    (change.file === "public/index.html" || change.file === "public/styles.css" || change.file === "public/robots.txt") &&
    (change.operation === "replace" || change.operation === "append" || change.operation === "create") &&
    typeof change.value === "string" &&
    typeof change.rationale === "string" &&
    (change.target === undefined || typeof change.target === "string")
  );
}

function reportData(url: string, data: MaxData): Record<string, unknown> {
  const issueCount = data.findings.length;
  return {
    eyebrow: "Lighthouse SEO audit",
    heading: "custombasketball — SEO handoff",
    meta: ["Generated by Max", new URL(url).hostname, `${issueCount} issues`],
    summary: `Max ran Lighthouse SEO and Kimi K2.7 Code on the generated preview, scored ${data.seo_score}%, found ${issueCount} issue${issueCount === 1 ? "" : "s"}, and proposed ${data.suggestions.length} fix${data.suggestions.length === 1 ? "" : "es"}.`,
    suggestions: data.suggestions,
    doneLabel: "Handed to Maestro",
    kpis: [
      { value: data.seo_score, suffix: "%", label: "SEO score" },
      { value: issueCount, label: "Issues found" },
      { value: data.suggestions.length, label: "Fixes proposed" },
    ],
    chart: chartFromScore(data.seo_score, issueCount),
  };
}

function emptyReportData(url: string): Record<string, unknown> {
  return {
    eyebrow: "Lighthouse SEO audit",
    heading: "Auditing custombasketball",
    meta: ["Running in Max", new URL(url).hostname, "Waiting for Lighthouse"],
    doneLabel: "Handed to Maestro",
    kpis: [
      { value: 0, suffix: "%", label: "SEO score" },
      { value: 0, label: "Issues found" },
      { value: 0, label: "Fixes proposed" },
    ],
    chart: [16, 18, 20, 18, 16, 20],
  };
}

function chartFromScore(score: number, issueCount: number): number[] {
  const base = Math.max(12, score);
  return [base * 0.45, base * 0.58, base * 0.67, base * 0.82, base * 0.9, Math.max(18, 100 - issueCount * 8)].map((n) =>
    Math.round(Math.min(96, n)),
  );
}

function stripMarkup(text: string): string {
  return text.replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/\s+/g, " ").trim();
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
