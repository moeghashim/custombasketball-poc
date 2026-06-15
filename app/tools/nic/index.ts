import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { postSigned } from "../../shared/signing.js";
import type { FlowEvent, JobRequest, ToolResult } from "../../shared/types.js";

interface NicData {
  url: string;
  project?: string;
  service?: string;
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
  await send({ event: "log", step: "build", kind: "dim", text: "generating static storefront template" });

  const site = buildStorefront();
  const project = railwayProjectName(brief.job_id);
  const workDir = await mkdtemp(path.join(os.tmpdir(), `nic-${project}-`));
  const appDir = path.join(workDir, "app");

  await send({ event: "progress", step: "build", n: 1 });
  await send({ event: "log", step: "build", kind: "ok", text: "5 custom jerseys modeled" });
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

async function writeRailwayApp(appDir: string, site: ReturnType<typeof buildStorefront>): Promise<void> {
  const publicDir = path.join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "index.html"), site.html);
  await writeFile(path.join(publicDir, "styles.css"), site.css);
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

  if (!configuredProject && !process.env.RAILWAY_TOKEN) {
    const initArgs = ["init", "--name", project, "--json"];
    const workspace = optionalEnv(["RAILWAY_WORKSPACE", "RAILWAY_WORKSPACE_ID", "GENERATED_SITE_HOST_WORKSPACE_ID"]);
    if (workspace) initArgs.push("--workspace", workspace);
    await runRailway(initArgs, cwd);
  }

  const deployArgs = ["up", "--detach", "--json", "--yes", "--message", `custombasketball ${project}`];
  if (configuredProject) deployArgs.push("--project", configuredProject);
  if (configuredEnvironment) deployArgs.push("--environment", configuredEnvironment);
  if (configuredService) deployArgs.push("--service", configuredService);
  const deployOutput = await runRailway(deployArgs, cwd);

  const service = configuredService || (await firstRailwayService(cwd));
  const url =
    findRailwayUrl(deployOutput) ||
    (service ? await ensureRailwayDomain(cwd, service, configuredProject, configuredEnvironment) : null) ||
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
  service: string,
  project: string | undefined,
  environment: string | undefined,
): Promise<string | null> {
  const args = ["domain", "--service", service, "--json"];
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
  const base = `cb-${jobId.toLowerCase()}`.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  let name = base.slice(0, 58).replace(/^-+/, "").replace(/-+$/, "");
  if (!/^[a-z0-9]/.test(name)) name = `cb-${name}`;
  name = name.slice(0, 58).replace(/-+$/, "");
  if (!/[a-z0-9]$/.test(name)) name = `${name}0`.slice(0, 58);
  return name || "cb-site";
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

function buildStorefront() {
  const jerseys = [
    { name: "Downtown Fade", design: "Black-to-gold gradient with stitched skyline trim", price: 89 },
    { name: "Ice Court", design: "White mesh body with powder blue side panels", price: 84 },
    { name: "Sunset Drive", design: "Coral, navy, and cream throwback striping", price: 92 },
    { name: "Rec League Pro", design: "Forest green base with cream varsity lettering", price: 79 },
    { name: "Midnight Five", design: "Matte navy jersey with silver number kit", price: 95 },
  ];

  const cards = jerseys
    .map(
      (jersey, index) => `
        <article class="jersey-card">
          <div class="jersey-art jersey-${index + 1}">
            <span class="neck"></span>
            <strong>${String(index + 1).padStart(2, "0")}</strong>
          </div>
          <div>
            <h3>${jersey.name}</h3>
            <p>${jersey.design}</p>
            <div class="price">$${jersey.price}</div>
          </div>
        </article>
      `,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>custombasketball | Custom Basketball Jerseys</title>
  <meta name="description" content="Build custom basketball jerseys for teams, leagues, and pickup crews with fast previews and premium stitched finishes.">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">custombasketball</a>
    <nav aria-label="Primary">
      <a href="#jerseys">Jerseys</a>
      <a href="#process">Process</a>
      <a href="#quote">Quote</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">Team uniforms made personal</p>
        <h1>Custom basketball jerseys built for your exact roster.</h1>
        <p class="lede">Pick a design route, add names and numbers, and get production-ready mockups for your squad.</p>
        <a class="button" id="quote" href="mailto:orders@custombasketball.example">Start a team quote</a>
      </div>
      <div class="hero-jersey" aria-label="Featured custom jersey preview">
        <span class="neck"></span>
        <strong>23</strong>
        <em>YOUR TEAM</em>
      </div>
    </section>
    <section class="section-head" id="jerseys">
      <p class="eyebrow">Five launch designs</p>
      <h2>Choose the jersey that fits your game.</h2>
    </section>
    <section class="grid">
      ${cards}
    </section>
    <section class="process" id="process">
      <div>
        <p class="eyebrow">How it works</p>
        <h2>From roster to ready-to-print in three steps.</h2>
      </div>
      <ol>
        <li>Send team colors, names, numbers, and sizes.</li>
        <li>Review a production mockup for every player.</li>
        <li>Approve the set and receive your ship date.</li>
      </ol>
    </section>
  </main>
</body>
</html>`;

  const css = `:root{color-scheme:light;--ink:#171717;--muted:#67615a;--line:#ded8cd;--paper:#fff;--tint:#f4f0e8;--gold:#dca43a;--blue:#243d73;--green:#2d7657}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f4ee;color:var(--ink)}a{color:inherit}.site-header{display:flex;align-items:center;justify-content:space-between;padding:24px clamp(20px,5vw,64px);background:rgba(255,255,255,.82);border-bottom:1px solid var(--line);position:sticky;top:0;backdrop-filter:blur(12px);z-index:2}.brand{font-weight:800;text-decoration:none;letter-spacing:-.03em}.site-header nav{display:flex;gap:22px;font-size:14px;color:var(--muted)}.site-header nav a{text-decoration:none}.hero{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:48px;align-items:center;padding:72px clamp(20px,6vw,88px) 52px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:12px;font-weight:800;color:var(--green);margin:0 0 12px}.hero h1{font-size:clamp(42px,6vw,76px);line-height:.92;letter-spacing:-.06em;margin:0;max-width:820px}.lede{font-size:19px;line-height:1.55;color:var(--muted);max-width:620px;margin:24px 0 32px}.button{display:inline-flex;align-items:center;justify-content:center;background:var(--ink);color:white;border-radius:999px;padding:14px 22px;text-decoration:none;font-weight:750}.hero-jersey,.jersey-art{position:relative;display:grid;place-items:center;aspect-ratio:.78;border-radius:28px 28px 18px 18px;background:linear-gradient(135deg,var(--blue),#111827 52%,var(--gold));box-shadow:0 28px 80px -45px rgba(0,0,0,.65);overflow:hidden}.hero-jersey:before,.jersey-art:before{content:"";position:absolute;inset:18px;border:2px solid rgba(255,255,255,.28);border-radius:22px 22px 14px 14px}.neck{position:absolute;top:-18px;width:96px;height:64px;border-radius:0 0 999px 999px;background:#f7f4ee}.hero-jersey strong{font-size:116px;color:#fff;letter-spacing:-.08em;z-index:1}.hero-jersey em{position:absolute;bottom:72px;color:#fff;font-style:normal;font-weight:900;letter-spacing:.12em}.section-head{padding:24px clamp(20px,6vw,88px)}.section-head h2,.process h2{font-size:clamp(28px,4vw,46px);line-height:1;letter-spacing:-.04em;margin:0}.grid{display:grid;grid-template-columns:repeat(5,minmax(180px,1fr));gap:16px;padding:10px clamp(20px,6vw,88px) 72px}.jersey-card{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:16px}.jersey-card h3{font-size:18px;margin:0 0 8px}.jersey-card p{color:var(--muted);font-size:14px;line-height:1.45;margin:0}.price{margin-top:16px;font-weight:900}.jersey-art{border-radius:20px;min-height:210px}.jersey-art strong{color:white;font-size:56px;z-index:1}.jersey-2{background:linear-gradient(135deg,#fff,#9cc8e8 60%,#243d73)}.jersey-3{background:linear-gradient(135deg,#ff7d59,#1d2f55)}.jersey-4{background:linear-gradient(135deg,#22543d,#f4e8c1)}.jersey-5{background:linear-gradient(135deg,#111827,#243d73 60%,#cbd5e1)}.process{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:0 clamp(20px,6vw,88px) 72px;padding:32px;background:#fff;border:1px solid var(--line);border-radius:8px}.process ol{margin:0;padding-left:22px;color:var(--muted);line-height:1.8;font-weight:650}@media(max-width:980px){.hero{grid-template-columns:1fr}.hero-jersey{max-width:360px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.process{grid-template-columns:1fr}}@media(max-width:560px){.site-header{align-items:flex-start;gap:14px;flex-direction:column}.grid{grid-template-columns:1fr}.hero{padding-top:44px}.hero h1{font-size:42px}}`;

  return { html, css, jerseys };
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
