# custombasketball — POC

A proof of concept for the tenwhy MVP loop: **Maestro** (deployed on Render, Neon
Postgres for job state) orchestrates **Nic** (site builder) and **Max** (SEO), each in
its own **Blaxel** sandbox, deploying `custombasketball` to **Cloudflare Pages** and
narrating the run **live** — orchestration infra provisioned through **Stripe Projects**
(Cloudflare Pages is a direct, free account, not a Stripe Projects vendor).

**Start here → [`process.md`](process.md)** — the complete build brief; read it top to
bottom. The visual design bundle is in [`design/`](design/) (read
`design/process/README.md` first).

This is its own repository — not part of the tenwhy design-doc site.
