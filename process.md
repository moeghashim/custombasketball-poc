# POC — custombasketball: build a site, then SEO it, shown live

**Audience: the implementing agent (Codex).** This is a proof of concept, but a
*faithful* one — it builds the design's **MVP proving loop** (a real Maestro
orchestrating real specialists in sandboxes via the job contract), not a toy. Build
the smallest thing that hits the success criteria and *looks* like the design. **The
stack and vendors are locked in §7 — build exactly those, no substitutions.** If
something genuinely isn't covered, ask the user rather than guessing.

---

## 0. This is its own repository

This POC lives in its **own repo**, separate from the tenwhy design-doc site. You're in
it now: `process.md` (this file) + `design/` (the Claude Design bundle — read-only); you
build the app under `app/` (layout in §7).

- This repo is already on GitHub (private):
  **`github.com/moeghashim/custombasketball-poc`**. You're working in a clone of it — if
  you don't have it yet, `git clone https://github.com/moeghashim/custombasketball-poc.git`.
  **Commit and push as you go.** **Do not** add this POC to the tenwhy repo.

### Before you build — verify (don't guess)
- `stripe projects catalog render · neon · blaxel · daytona` — confirm the exact service
  refs, **and that your country supports paid provisioning** for them.
- **Blaxel:** how to build + push a custom sandbox image (the Node 20 + Chromium + CLIs
  image) — check the Blaxel docs.
- **Daytona:** the exact **preview-URL** method on `@daytona/sdk` — check the Daytona docs.
- The 5 jerseys' demo content (names / designs / prices) is yours to invent — keep it
  plausible.

---

## 1. What we're proving

One page, one button — **"Create the website"**. Click it and **Maestro** (a real,
always-on orchestrator) runs two specialists in sequence, each **in its own sandbox**,
with the page narrating it all **live**:

1. **Nic** (website builder) → builds **`custombasketball`** with **5 custom jerseys**,
   deploys it to **Daytona** (provisioned via Stripe Projects), returns a live URL.
2. **Max** (SEO) → audits that live site, produces **suggested changes**, hands them
   back to Maestro.

### Success criteria

Done when **all eight** are true — a reviewer checks each by clicking the button once
and watching (plus a peek at Maestro's DB):

1. **One button runs everything.** Click → Maestro runs Nic then Max, no other steps.
2. **Nic builds the store via Stripe Projects → a real live URL** — `custombasketball`
   with 5 jerseys, deployed to **Daytona** (provisioned via Stripe Projects) and reachable
   at its live preview URL. *(user #1)*
3. **Max audits that live URL and produces concrete output** — real findings (SEO score
   + specific issues) and a list of **suggested changes**.
4. **Max hands the suggestions to Maestro**, which receives them and acknowledges "would
   execute". Applying the fixes is out of scope. *(user #2)*
5. **Nic and Max are real CLIs that run in Blaxel sandboxes**, fired by Maestro via the
   **job contract** (a signed request → a signed result). Maestro has **no CLI**.
6. **Maestro is real, not a stub:** an always-on service that records every job in
   **Postgres** (a `jobs` state machine + `results`), so a run is durable and
   inspectable.
7. **The round trip is genuine:** Maestro fires a job into a sandbox; the specialist
   **webhooks a signed result back**; Maestro validates, records, and advances.
8. **The page narrates it live** — the `build` then `report` stages of the Process
   Steps v2 design animate from the **real streamed events**, not a canned timer.

---

## 2. The visual — use the design in `./design/`

A Claude Design handoff bundle is in **`design/process/`**. **Read it first**, in
order: `README.md` → `chats/chat1.md` → `project/Process Steps v2.html` → then its
imports (`flow.jsx`, `stages.jsx`, `styles.css`). **Recreate it faithfully** (the
prototype is React-via-Babel, no build step — keep that approach; match the visual).

### How it's wired
`Process Steps v2.html` runs in **`live` mode** — a controller (`createFlowController`,
`flow.jsx`) is driven by *real events*, not a timer. Its demo `backendDemo(c)` simulates
those events; **replace it with a driver fed by Maestro's SSE stream**. Controller API:

| Call | Use |
|---|---|
| `c.activate(stepId)` | mark a step in-progress |
| `c.pushLog(stepId, {kind, text})` | append a terminal line (`kind`: `cmd·ok·arr·dim`) |
| `c.mergeData(stepId, {…})` | set/replace fields (url, kpis, chart, heading…) |
| `c.progress(stepId, n)` | reveal the n-th sub-result |
| `c.complete(stepId)` | mark done; auto-advances |
| `c.restart()` | replay |

### Map Nic and Max onto the stages (`window.STAGES`, `stages.jsx`)
- **Nic → `type: "build"`** (`StageBuild`): browser wireframe assembling + a live
  terminal. Driven by Nic's events: `activate` → a stream of `log`s → `data {url}` →
  `complete`.
- **Max → `type: "report"`** (`StageReport`): audit card with eyebrow, heading, KPIs,
  bar chart, done-badge. Driven by Max's events; `doneLabel: "Handed to Maestro"`.

The **"Create the website" button** does `POST /api/run`, then opens `GET /api/events`
(SSE) and feeds every event into the controller.

---

## 3. Architecture — the MVP proving loop (POC-sized)

This is the design's loop made real (build.html Phase 1–2; design **§9 job contract**,
**§11 durable orchestration**). It cuts only multi-tenancy, auth, the brain repo, and
the plan/apply gate/broker (§4) — **not** the orchestrator, the durable state, the job
contract, or the sandbox.

```
[ Page: Process Steps v2 ] ──click "Create the website"──► POST /api/run
        ▲  GET /api/events (SSE, live)                          │
        │                                                       ▼
[ Maestro — always-on Express + Neon Postgres ]
   jobs/results state machine · job contract · signed webhook
        │  fire job (signed request)                  ▲ signed events + result
        ▼                                             │ (HTTPS webhook)
[ Blaxel sandbox — ephemeral, one per job ]  run `nic build` / `max audit`
        └─ Nic → deploy site to Daytona → { url }   Max → Lighthouse(url) → { suggestions }
```

**The round trip, per step:**
1. Maestro inserts a `jobs` row (`queued`), composes the **request** — `{ job_id,
   agent, task, brief, callback_url }` + an HMAC secret — and marks it `dispatched`.
2. Maestro creates an ephemeral **Blaxel sandbox** (`SandboxInstance.createIfNotExists`),
   puts the CLI in it, and `sandbox.process.exec`s `nic build …` / `max audit …` → `running`.
3. The CLI works and **POSTs** its NDJSON progress events + a final **HMAC-signed**
   result envelope to `callback_url` (Maestro's webhook). This is the design's "µVM
   webhooks back," exactly.
4. Maestro verifies the signature, writes `results`, relays each event to the page over
   SSE, sets `succeeded`/`failed`, deletes the sandbox, and **advances** to the next step.
5. After Max: Maestro holds the suggestions and acknowledges "would execute".

### Maestro — the orchestrator (real, thin only where it can be)
- **Always-on Express service. No CLI.** It owns the run.
- **Durable job state in Neon Postgres** (provisioned via Stripe Projects): a `jobs`
  table with a real state machine — `queued → dispatched → running → {succeeded ·
  failed · timed_out}` — and a `results` table. A run survives a restart and is
  inspectable. (The §11 control plane, shrunk: state machine + the two tables, no
  outbox/leases/reconciliation yet.)
- **The job contract:** fires each specialist with a structured **request** and accepts
  a structured, **HMAC-signed response** at its webhook — same shape as design §9.
- **Fires specialists into Blaxel sandboxes** (next), waits for the signed result,
  validates + records it, advances.
- **Deployed, not local.** Maestro runs as a **Render web service** (provisioned via
  Stripe Projects), so it has a stable public URL — the Blaxel sandboxes post their signed
  results straight to it, no tunnel. Render's env carries the Stripe Projects creds (Neon,
  Blaxel, Daytona).

### Building the CLIs (Nic & Max)
Nic and Max are the two **tools**, built as **CLIs** — the unit of work in tenwhy
(`https://tenwhy.pages.dev/tool`, `CONTRACT.md`). For the POC, build a **minimal**
version of that contract — do **not** build the full `agent-cli-kit` first; a tiny
shared helper is enough. Note in comments where the real version differs.

- **Stack:** TypeScript on Node 20, run via **`tsx`**, bundled to one file each (esbuild).
  Live under `app/tools/` — `nic`, `max`.
- **One Blaxel image for both:** bake a single sandbox image — `node:20-slim` + Chromium
  (Max needs it) + both CLI bundles — and run every job's sandbox from it; Maestro execs
  `nic build` or `max audit`. (Production uses one image per tool; the POC shares one so
  there's a single image to build + push.)
- **Invocation (inside the sandbox):**
  ```
  nic build --brief '<json>'      # { job_id, callback_url, … }; HMAC secret via env
  max audit --brief '<json>'      # { job_id, callback_url, url, … }
  ```
- **Transport = the job contract, not stdout.** Each CLI **POSTs** to `callback_url`
  (signed with the per-job HMAC secret) as it works:
  ```
  POST {callback_url}   { "job_id": "…", "event": { "event":"log", "step":"build", "kind":"ok", "text":"built in 4.18s" } }
  POST {callback_url}   { "job_id": "…", "event": { "event":"data", "step":"build", "patch": { "url":"https://…" } } }
  … then the final result …
  POST {callback_url}   { "job_id": "…", "result": { "ok":true, "tool":"nic", "command":"build",
                                                     "data": { "url":"https://…" }, "error":null, "meta": {…} } }
  ```
  Event shapes map 1:1 to the page controller (`activate→c.activate`, `log→c.pushLog`,
  `data→c.mergeData`, `progress→c.progress`, `complete→c.complete`). `step` = `build`
  for Nic, `report` for Max. (CLIs may *also* print NDJSON to stdout for local debugging.)
- **POC cuts for the CLIs:** skip `--describe`, the full flag set, plan/apply gate/broker.
  **Keep:** the `{ok,data,error,meta}` result + the signed event stream — that's what
  keeps them faithful to the contract and the page live.

### Nic — the website builder
- CLI `nic build`, running inside its **Blaxel** sandbox. Generates **`custombasketball`**
  — a static store with **5 custom jerseys** from a **hard-coded template** + placeholder
  imagery (no LLM).
- **Deploys the generated site to Daytona** (`@daytona/sdk`; `DAYTONA_API_KEY` injected by
  Maestro from `stripe projects env`): `new Daytona()` → `daytona.create()` → `sandbox.fs`
  writes the built site → `sandbox.process.codeRun` starts a static server on a port →
  fetch the **public preview URL** for that port (Daytona's preview API). That URL is the
  live site, and it stays up so Max can audit it and the demo can show it.
- Emits `log` events through generate + deploy, a `data {url}` patch with the preview URL,
  then the final result `{ url }`.

### Max — the SEO specialist
- CLI `max audit --brief '{… url …}'`, running inside its **Blaxel** sandbox. Runs
  **Lighthouse** (`lighthouse` + `chrome-launcher`) against the Daytona URL → the **SEO
  category score** + the failing audits.
- **Why a Chrome-capable image:** Lighthouse doesn't read HTML — it *loads the page in a
  real headless Chromium* and measures it (that's where the SEO/perf/a11y scores come
  from). So the sandbox's container image must contain Chromium + its system libs.
  Build a custom Blaxel image — `FROM node:20-slim` then install Chromium (`npx playwright
  install --with-deps chromium`, or `apt-get install -y chromium`) — and pass it as the
  `image:` of `createIfNotExists`. Launch Chrome with `--no-sandbox --headless
  --disable-dev-shm-usage` (it runs as root in a container). *(Alternative: install
  Chromium at job start — smaller image, slower per run.)*
- Output = **findings + suggested changes**, derived from the failing audits → mapped to
  the report stage's KPIs/chart (SEO score, issues found, fixes proposed).
- Final result `{ findings, suggestions }`. Maestro receives it, the page shows the
  `report` stage completing with `doneLabel: "Handed to Maestro"`, Maestro acknowledges.
  The POC does **not** execute the fixes (out of scope).

---

## 4. Explicit cuts (do NOT build these)
- **Multi-tenancy, auth** — one hard-coded demo (`custombasketball`, 5 jerseys), no users.
- **The brain repo / `dashboard.json` / catalog** — none. Briefs are composed in code.
- **plan/apply gate + broker** — Max *suggests*; nothing is executed. No approval card.
- **Durable-orchestration extras** — keep the `jobs` state machine + `results`; skip the
  outbox/inbox, leases, retries, reconciliation sweep.
- **agent-cli-kit** — CLIs use a minimal hand-rolled helper, not the full kit.
- **Run-tracking UI / cost accounting** — none, no dashboard. Run history *is* the Neon
  `jobs`/`results` tables (status, durations, errors, outputs — query them directly);
  **spend is `stripe projects spend`** (by provider). Don't build either.

What we **do** build (don't cut): the always-on Maestro, Postgres job state, the job
contract, the signed webhook round trip, and **Blaxel sandboxes** for the specialists.

---

## 5. Build order
1. **Scaffold** `app/` (one npm project: TypeScript, Node 20, tsx).
2. **Provision via Stripe Projects:** `stripe plugin install projects` → `projects init`
   → `projects add neon` → `projects add render` → `projects add blaxel` →
   `projects add daytona` → `projects env --pull` (lands `DATABASE_URL`, Blaxel creds,
   `DAYTONA_API_KEY`).
3. **Maestro core + deploy:** Express + Neon (`jobs`, `results` + the state machine) +
   `POST /api/run`, `GET /api/events` (SSE), and the **signed webhook** `POST
   /api/jobs/:id/ingest`. **Deploy to Render** so the webhook has a public URL.
4. **Recreate the Process Steps page** in live mode; drive its controller from the SSE
   stream (prove it with fake events first).
5. **The `nic build` CLI:** generate `custombasketball` (5 jerseys) → deploy to a Daytona
   sandbox (preview URL) → POST `log`/`data`/`complete` events + final `{ url }` to the callback.
6. **The `max audit` CLI:** Lighthouse the Daytona URL → POST `report`-stage events + final
   `{ findings, suggestions }`.
7. **Blaxel wiring:** Maestro creates a Blaxel sandbox per job (`@blaxel/core`), injects the
   brief + secrets, `exec`s the CLI, tears it down on result. (Max's image is Chrome-capable.)
8. **Wire the callback:** Maestro passes its public **Render URL** as `callback_url` in
   each job request; the Blaxel sandboxes post events/results straight there.

---

## 6. Definition of done
- Click **Create the website** → Maestro fires Nic, then Max — each in its **own Blaxel
  sandbox** — and the **`jobs` table shows the two jobs** moving through the state machine.
- Nic builds `custombasketball` (5 jerseys), deploys it to a **Daytona** sandbox
  (provisioned via Stripe Projects), and yields a **real live preview URL**.
- Max audits the URL with **Lighthouse** → findings + suggestions; **POSTs a signed
  result** to Maestro, which records it and acknowledges "would execute".
- The page narrates it **live** (`build` then `report` stages) from the real streamed
  events, and **looks like** `Process Steps v2.html`.

---

## 7. Locked stack & vendors — no guessing

Build exactly this; don't substitute.

| Concern | Locked choice |
|---|---|
| Provisioning · creds · billing | **Stripe Projects** — `add neon`, `add render`, `add blaxel`, `add daytona`; `env --pull`. *(success #2)* |
| Maestro's store | **Neon Postgres** via Stripe Projects — `jobs` + `results` tables + the state machine. |
| Specialist sandbox | **Blaxel** (`@blaxel/core`) — ephemeral, one sandbox per job (`createIfNotExists` → `process.exec` → `delete`). Provisioned via Stripe Projects. Max's image is **Chrome-capable**. |
| Generated-site host | **Daytona** (`@daytona/sdk`, `DAYTONA_API_KEY` from Stripe Projects) — Nic creates a Daytona sandbox, writes the built site, runs a static server, exposes a **public preview URL** (the live site). |
| Language · runtime · pkg-mgr | **TypeScript** · **Node 20** · **`tsx`** · **npm**. |
| Maestro service | **Express** + **SSE** (`/api/run`, `/api/events`) + a **signed webhook** (`/api/jobs/:id/ingest`). **Deployed to Render** via Stripe Projects (public URL — sandboxes post straight to it, no tunnel). |
| The page | **The design, recreated as-is** — React + Babel from CDN, no build step; live mode. |
| Nic | CLI `nic build` (in a Blaxel sandbox); **hard-coded** `custombasketball` (5 jerseys); deploys the site to **Daytona**. |
| Max | CLI `max audit` (in a Chrome-capable Blaxel sandbox); **Lighthouse** → suggestions. |
| Job contract | Request `{ job_id, agent, task, brief, callback_url }` + HMAC secret → **HMAC-signed** events + final `{ok,data,error,meta}` to Maestro's webhook. |

### Folder layout (build exactly this)
```
. (repo root)
├── process.md
├── design/…                  # the Claude Design bundle — read-only reference
└── app/                      # one npm project (TypeScript · Node 20 · tsx · npm)
    ├── package.json          # express, @blaxel/core, @daytona/sdk, pg, lighthouse, chrome-launcher, …
    ├── server/
    │   ├── maestro.ts        # orchestrator: state machine, fires specialists into Blaxel
    │   ├── db.ts             # Neon Postgres — jobs, results
    │   ├── webhook.ts        # verifies + ingests signed events/results from sandboxes
    │   └── sse.ts            # /api/events stream to the page
    ├── web/                  # the Process Steps page (design recreated, live mode)
    └── tools/
        ├── nic/              # nic build CLI  (runs inside a Blaxel sandbox)
        └── max/              # max audit CLI  (runs inside a Blaxel sandbox)
```

**Accounts that must exist (via Stripe Projects):** Neon, Render, Blaxel, Daytona.
Confirm the catalog refs with `stripe projects catalog <name>`. Blaxel needs a Node-20
base image — and for Max, a **Chrome-capable** one (see Max, above).

---

## 8. References
- **Design bundle:** `design/process/` — read its `README.md` first.
- **tenwhy architecture (the loop we're proving):** `https://tenwhy.pages.dev/design`
  (§9 job contract, §11 durable orchestration), the build guide `…/tool`, `CONTRACT.md`,
  the build phases on `…/build`.
- **Stripe Projects:** `https://docs.stripe.com/projects` (provisioning + creds + billing).
- **Blaxel (specialist sandboxes):** `https://docs.blaxel.ai/Sandboxes/Overview`,
  `…/Sandboxes/Processes`, SDK `https://docs.blaxel.ai/sdk-reference/introduction`
  (package `@blaxel/core`).
- **Daytona (generated-site host):** `https://www.daytona.io/docs/` — sandboxes, process
  execution, and **preview URLs** (`/docs/en/preview`); SDK `@daytona/sdk`.
- **Render (Maestro host):** a web service, provisioned via Stripe Projects.
- **Neon (Maestro DB):** Postgres; provisioned via Stripe Projects (`DATABASE_URL`).
