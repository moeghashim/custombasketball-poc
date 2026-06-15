import { Daytona } from "@daytona/sdk";
import { postSigned } from "../../shared/signing.js";
import type { FlowEvent, JobRequest, ToolResult } from "../../shared/types.js";

interface NicData {
  url: string;
  sandbox_id?: string;
}

const PORT = 3000;

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
  await send({ event: "progress", step: "build", n: 1 });
  await send({ event: "log", step: "build", kind: "ok", text: "5 custom jerseys modeled" });
  await send({ event: "progress", step: "build", n: 2 });
  await send({ event: "log", step: "build", kind: "dim", text: "writing responsive HTML/CSS bundle" });

  const daytona = new Daytona();
  const sandbox = await (daytona as any).create({
    language: "typescript",
    name: `custombasketball-${brief.job_id.slice(0, 8)}`,
    envVars: { NODE_ENV: "production" },
    public: true,
  });

  await send({ event: "progress", step: "build", n: 3 });
  await send({ event: "log", step: "build", kind: "arr", text: "created Daytona sandbox" });

  await uploadSite(sandbox, site);
  await send({ event: "log", step: "build", kind: "ok", text: "uploaded storefront files" });

  await sandbox.process.executeCommand(
    `nohup python3 -m http.server ${PORT} --bind 0.0.0.0 > /tmp/custombasketball.log 2>&1 &`,
    "workspace/custombasketball",
    undefined,
    10,
  );

  await send({ event: "progress", step: "build", n: 4 });
  await send({ event: "log", step: "build", kind: "arr", text: "started static server on Daytona" });

  const preview = await getPreviewUrl(sandbox, PORT);
  await send({ event: "data", step: "build", patch: { url: preview } });
  await send({ event: "log", step: "build", kind: "ok", text: `live · ${preview}` });
  await send({ event: "progress", step: "build", n: 5 });
  await send({ event: "complete", step: "build" });

  const result: ToolResult<NicData> = {
    ok: true,
    tool: "nic",
    command: "build",
    data: { url: preview, sandbox_id: sandbox.id },
    error: null,
    meta: {
      product_count: site.jerseys.length,
      host: "daytona",
      generated_at: new Date().toISOString(),
    },
  };
  await emit(brief, secret, { result });
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

async function uploadSite(sandbox: any, site: ReturnType<typeof buildStorefront>): Promise<void> {
  await sandbox.fs.createFolder("workspace/custombasketball", "755");
  await sandbox.fs.uploadFile(Buffer.from(site.html), "workspace/custombasketball/index.html");
  await sandbox.fs.uploadFile(Buffer.from(site.css), "workspace/custombasketball/styles.css");
}

async function getPreviewUrl(sandbox: any, port: number): Promise<string> {
  if (typeof sandbox.getSignedPreviewUrl === "function") {
    const signed = await sandbox.getSignedPreviewUrl(port, 24 * 60 * 60);
    if (signed?.url) return signed.url;
  }

  const preview = await sandbox.getPreviewLink(port);
  if (!preview?.url) throw new Error("Daytona did not return a preview URL");
  return preview.url;
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
  const raw = process.argv[process.argv.indexOf("--brief") + 1];
  if (!raw) throw new Error("missing --brief");
  return JSON.parse(raw) as JobRequest;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
