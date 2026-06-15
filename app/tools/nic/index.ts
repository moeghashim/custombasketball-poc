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
  brand: string;
  headline: string;
  subheadline: string;
  cta: string;
  jerseys: SiteJersey[];
  proof_points?: string[];
  process_steps?: string[];
  palette?: {
    ink?: string;
    paper?: string;
    tint?: string;
    accent?: string;
    blue?: string;
    gold?: string;
  };
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
  await send({ event: "log", step: "build", kind: "dim", text: "asking Kimi K2.7 Code for storefront content and design direction" });

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
      "You are Nic, a senior ecommerce site builder. Return only valid JSON. Create a compact content and design spec for a custom basketball jersey storefront.",
    user: JSON.stringify({
      task: "Generate the content and design direction for a complete custombasketball website.",
      brand: brief.brand || "custombasketball",
      product_count: brief.product_count || 5,
      requirements: [
        "Exactly 5 custom basketball jersey products.",
        "Use real visible product names, design descriptions, prices, and a clear quote CTA.",
        "Make the tone polished, direct, and suitable for a team-uniform storefront.",
        "Do not return HTML, CSS, Markdown, scripts, or external asset references.",
        "Keep every field concise enough for a fast API response.",
      ],
      output_shape: {
        brand: "custombasketball",
        headline: "specific homepage headline",
        subheadline: "one sentence value proposition",
        cta: "short primary call to action",
        jerseys: [{ name: "string", design: "string", price: 89 }],
        proof_points: ["three short trust/value points"],
        process_steps: ["four short ordering steps"],
        palette: {
          ink: "#15171f",
          paper: "#fbfaf6",
          tint: "#eef4f7",
          accent: "#c9472f",
          blue: "#214a7a",
          gold: "#f2b544",
        },
      },
    }),
    temperature: 0.45,
    maxTokens: 2800,
  });

  return renderStorefront(validateSpec(response.data), response.model);
}

function validateSpec(spec: KimiSiteResponse): KimiSiteResponse {
  if (!spec || typeof spec !== "object") throw new Error("Kimi did not return a storefront spec object");
  const jerseys = Array.isArray(spec.jerseys) ? spec.jerseys.filter(isJersey).slice(0, 5) : [];
  if (jerseys.length !== 5) throw new Error("Kimi must return exactly 5 jersey products");

  return {
    brand: plainText(spec.brand, "custombasketball"),
    headline: plainText(spec.headline, "Custom basketball jerseys built for your whole squad"),
    subheadline: plainText(
      spec.subheadline,
      "Choose a design direction, personalize every roster detail, and launch a polished team store in minutes.",
    ),
    cta: plainText(spec.cta, "Start a team quote"),
    jerseys,
    proof_points: nonEmptyStrings(spec.proof_points, [
      "Five ready-to-customize jersey systems",
      "Responsive team store preview",
      "Fast quote handoff for coaches and captains",
    ]).slice(0, 3),
    process_steps: nonEmptyStrings(spec.process_steps, [
      "Pick a jersey base",
      "Send colors and roster details",
      "Review the digital mockup",
      "Approve production",
    ]).slice(0, 4),
    palette: spec.palette,
  };
}

function renderStorefront(spec: KimiSiteResponse, model: string): SiteBuild {
  const palette = {
    ink: hexOr(spec.palette?.ink, "#171923"),
    paper: hexOr(spec.palette?.paper, "#fbfaf6"),
    tint: hexOr(spec.palette?.tint, "#edf4f2"),
    accent: hexOr(spec.palette?.accent, "#c84935"),
    blue: hexOr(spec.palette?.blue, "#24527a"),
    gold: hexOr(spec.palette?.gold, "#f1b646"),
  };
  const brand = escapeHtml(spec.brand);
  const headline = escapeHtml(spec.headline);
  const subheadline = escapeHtml(spec.subheadline);
  const cta = escapeHtml(spec.cta);
  const description = escapeHtml(`${spec.brand} builds custom basketball jerseys and team stores with five polished uniform options.`);
  const proofPoints = (spec.proof_points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("\n");
  const processSteps = (spec.process_steps || [])
    .map(
      (step, index) => `<li>
            <span>${String(index + 1).padStart(2, "0")}</span>
            <strong>${escapeHtml(step)}</strong>
          </li>`,
    )
    .join("\n");
  const jerseyCards = spec.jerseys
    .map(
      (jersey, index) => `<article class="jersey-card">
          <div class="jersey-art jersey-art-${index + 1}" aria-hidden="true">
            <span class="neck"></span>
            <span class="number">${index + 7}</span>
            <span class="stripe stripe-one"></span>
            <span class="stripe stripe-two"></span>
          </div>
          <div class="jersey-copy">
            <h3>${escapeHtml(jersey.name)}</h3>
            <p>${escapeHtml(jersey.design)}</p>
            <strong>$${formatPrice(jersey.price)}</strong>
          </div>
        </article>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${brand} | Custom basketball jerseys</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="/">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="#top" aria-label="${brand} home">${brand}</a>
    <nav aria-label="Primary">
      <a href="#jerseys">Jerseys</a>
      <a href="#process">Process</a>
      <a href="#quote">Quote</a>
    </nav>
  </header>

  <main id="top">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">Team uniforms, built fast</p>
        <h1 id="hero-title">${headline}</h1>
        <p class="lede">${subheadline}</p>
        <a class="button" href="mailto:orders@custombasketball.example?subject=Custom%20basketball%20jersey%20quote">${cta}</a>
      </div>
      <div class="hero-panel" aria-label="Featured jersey preview">
        <div class="featured-jersey">
          <span class="neck"></span>
          <span class="hero-number">23</span>
          <span class="hero-name">CUSTOM</span>
        </div>
      </div>
    </section>

    <section class="proof" aria-label="Storefront highlights">
      <ul>
        ${proofPoints}
      </ul>
    </section>

    <section class="section" id="jerseys" aria-labelledby="jerseys-title">
      <div class="section-heading">
        <p class="eyebrow">Five modeled options</p>
        <h2 id="jerseys-title">Pick a uniform system and personalize the roster.</h2>
      </div>
      <div class="jersey-grid">
        ${jerseyCards}
      </div>
    </section>

    <section class="section process" id="process" aria-labelledby="process-title">
      <div class="section-heading">
        <p class="eyebrow">Ordering flow</p>
        <h2 id="process-title">From design direction to production approval.</h2>
      </div>
      <ol>
        ${processSteps}
      </ol>
    </section>

    <section class="quote" id="quote" aria-labelledby="quote-title">
      <div>
        <p class="eyebrow">Ready for a quote</p>
        <h2 id="quote-title">Bring colors, names, numbers, and deadline. Nic handles the first draft.</h2>
      </div>
      <a class="button secondary" href="mailto:orders@custombasketball.example?subject=Custom%20basketball%20jersey%20quote">Email the roster</a>
    </section>
  </main>

  <footer>
    <span>${brand}</span>
    <span>Generated by ${escapeHtml(model)} for the custombasketball proof of concept.</span>
  </footer>
</body>
</html>
`;

  const css = `:root {
  color-scheme: light;
  --ink: ${palette.ink};
  --paper: ${palette.paper};
  --tint: ${palette.tint};
  --accent: ${palette.accent};
  --blue: ${palette.blue};
  --gold: ${palette.gold};
  --line: color-mix(in srgb, var(--ink) 14%, transparent);
  --shadow: 0 22px 70px color-mix(in srgb, var(--ink) 16%, transparent);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}

a {
  color: inherit;
  text-decoration: none;
}

.site-header {
  align-items: center;
  background: color-mix(in srgb, var(--paper) 88%, white);
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 24px;
  justify-content: space-between;
  min-height: 72px;
  padding: 0 clamp(20px, 5vw, 72px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0;
}

nav {
  display: flex;
  gap: clamp(12px, 3vw, 28px);
  font-size: 0.92rem;
  font-weight: 700;
}

main {
  overflow: hidden;
}

.hero {
  align-items: stretch;
  display: grid;
  gap: clamp(24px, 5vw, 56px);
  grid-template-columns: minmax(0, 1.02fr) minmax(320px, 0.98fr);
  min-height: calc(100svh - 72px);
  padding: clamp(48px, 7vw, 96px) clamp(20px, 5vw, 72px) 32px;
}

.hero-copy {
  align-self: center;
  max-width: 740px;
}

.eyebrow {
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.13em;
  margin: 0 0 14px;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  font-size: clamp(3.8rem, 9vw, 8.5rem);
  letter-spacing: 0;
  line-height: 0.88;
  margin-bottom: 28px;
  max-width: 930px;
}

h2 {
  font-size: clamp(2rem, 4vw, 4.8rem);
  letter-spacing: 0;
  line-height: 0.96;
  margin-bottom: 0;
}

h3 {
  font-size: 1.15rem;
  letter-spacing: 0;
  line-height: 1.1;
  margin-bottom: 10px;
}

.lede {
  color: color-mix(in srgb, var(--ink) 72%, white);
  font-size: clamp(1.05rem, 2vw, 1.45rem);
  max-width: 680px;
}

.button {
  align-items: center;
  background: var(--ink);
  color: var(--paper);
  display: inline-flex;
  font-weight: 900;
  justify-content: center;
  margin-top: 18px;
  min-height: 48px;
  padding: 0 22px;
}

.button.secondary {
  background: var(--accent);
  color: white;
  flex: 0 0 auto;
  margin-top: 0;
}

.hero-panel {
  align-items: center;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--blue) 80%, black), var(--ink)),
    var(--blue);
  display: flex;
  justify-content: center;
  min-height: 520px;
  padding: clamp(28px, 5vw, 64px);
}

.featured-jersey,
.jersey-art {
  background: var(--paper);
  clip-path: polygon(18% 0, 36% 0, 50% 11%, 64% 0, 82% 0, 100% 28%, 82% 41%, 82% 100%, 18% 100%, 18% 41%, 0 28%);
  position: relative;
}

.featured-jersey {
  aspect-ratio: 0.82;
  box-shadow: var(--shadow);
  width: min(74%, 430px);
}

.neck {
  border: 10px solid color-mix(in srgb, var(--ink) 84%, transparent);
  border-bottom: 0;
  border-radius: 0 0 44px 44px;
  height: 48px;
  left: 50%;
  position: absolute;
  top: 20px;
  transform: translateX(-50%);
  width: 92px;
}

.hero-number {
  color: var(--accent);
  font-size: clamp(5rem, 10vw, 10rem);
  font-weight: 950;
  left: 50%;
  line-height: 1;
  position: absolute;
  top: 38%;
  transform: translate(-50%, -50%);
}

.hero-name {
  bottom: 22%;
  font-size: clamp(1rem, 2.6vw, 1.65rem);
  font-weight: 950;
  left: 50%;
  letter-spacing: 0.16em;
  position: absolute;
  transform: translateX(-50%);
}

.proof {
  padding: 0 clamp(20px, 5vw, 72px) clamp(42px, 7vw, 90px);
}

.proof ul {
  border-block: 1px solid var(--line);
  display: grid;
  gap: 0;
  grid-template-columns: repeat(3, 1fr);
  list-style: none;
  margin: 0;
  padding: 0;
}

.proof li {
  font-size: clamp(1rem, 1.6vw, 1.25rem);
  font-weight: 800;
  padding: 24px;
}

.proof li + li {
  border-left: 1px solid var(--line);
}

.section {
  padding: clamp(46px, 7vw, 100px) clamp(20px, 5vw, 72px);
}

.section-heading {
  align-items: end;
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 0.86fr) minmax(220px, 0.14fr);
  margin-bottom: clamp(28px, 5vw, 58px);
}

.jersey-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(5, minmax(180px, 1fr));
}

.jersey-card {
  background: white;
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 420px;
}

.jersey-art {
  align-self: center;
  aspect-ratio: 0.82;
  background: var(--blue);
  margin: 24px 24px 18px;
  width: min(72%, 190px);
}

.jersey-art-2 {
  background: var(--accent);
}

.jersey-art-3 {
  background: var(--ink);
}

.jersey-art-4 {
  background: color-mix(in srgb, var(--gold) 86%, white);
}

.jersey-art-5 {
  background: color-mix(in srgb, var(--blue) 70%, var(--accent));
}

.jersey-art .number {
  color: white;
  font-size: 3.4rem;
  font-weight: 950;
  left: 50%;
  line-height: 1;
  position: absolute;
  top: 46%;
  transform: translate(-50%, -50%);
}

.stripe {
  background: rgba(255, 255, 255, 0.72);
  bottom: 18%;
  height: 10px;
  left: 18%;
  position: absolute;
  right: 18%;
}

.stripe-two {
  bottom: 12%;
}

.jersey-copy {
  border-top: 1px solid var(--line);
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 18px;
}

.jersey-copy p {
  color: color-mix(in srgb, var(--ink) 70%, white);
  flex: 1;
  font-size: 0.95rem;
}

.jersey-copy strong {
  font-size: 1.35rem;
}

.process {
  background: var(--tint);
}

.process ol {
  counter-reset: step;
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(4, minmax(180px, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.process li {
  background: var(--paper);
  border: 1px solid var(--line);
  min-height: 160px;
  padding: 20px;
}

.process span {
  color: var(--accent);
  display: block;
  font-weight: 950;
  margin-bottom: 42px;
}

.process strong {
  display: block;
  font-size: 1.1rem;
  line-height: 1.15;
}

.quote {
  align-items: center;
  background: var(--ink);
  color: var(--paper);
  display: flex;
  gap: 28px;
  justify-content: space-between;
  padding: clamp(46px, 7vw, 100px) clamp(20px, 5vw, 72px);
}

.quote h2 {
  max-width: 980px;
}

footer {
  color: color-mix(in srgb, var(--ink) 62%, white);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.9rem;
  gap: 12px;
  justify-content: space-between;
  padding: 24px clamp(20px, 5vw, 72px);
}

@media (max-width: 1120px) {
  .hero,
  .section-heading {
    grid-template-columns: 1fr;
  }

  .hero {
    min-height: auto;
  }

  .jersey-grid {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }

  .process ol {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 700px) {
  .site-header,
  .quote,
  footer {
    align-items: flex-start;
    flex-direction: column;
  }

  nav {
    flex-wrap: wrap;
  }

  h1 {
    font-size: clamp(3rem, 17vw, 5.8rem);
  }

  .hero-panel {
    min-height: 390px;
  }

  .proof ul,
  .jersey-grid,
  .process ol {
    grid-template-columns: 1fr;
  }

  .proof li + li {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  .jersey-card {
    min-height: 360px;
  }
}
`;

  return { html, css, jerseys: spec.jerseys, model };
}

function isJersey(value: unknown): value is SiteJersey {
  if (!value || typeof value !== "object") return false;
  const jersey = value as Partial<SiteJersey>;
  return (
    typeof jersey.name === "string" &&
    jersey.name.trim().length > 0 &&
    typeof jersey.design === "string" &&
    jersey.design.trim().length > 0 &&
    typeof jersey.price === "number" &&
    Number.isFinite(jersey.price) &&
    jersey.price > 0
  );
}

function plainText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function nonEmptyStrings(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value)
    ? value.map((item) => plainText(item, "")).filter((item) => item.length > 0)
    : [];
  return items.length ? items : fallback;
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
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
