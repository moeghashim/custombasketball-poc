# custombasketball — POC

A proof of concept for the tenwhy MVP loop: **Maestro** (deployed on Render, Neon
Postgres for job state) orchestrates **Nic** (site builder) and **Max** (SEO), each in
its own **Blaxel** sandbox. Nic uses **Kimi K2.7 Code** to generate `custombasketball`,
deploys it to **Railway**, Max uses **Lighthouse + Kimi K2.7 Code** to propose SEO
changes, and Maestro evaluates the proposal with **OpenAI `gpt-5.5` high reasoning** while
narrating the run **live** — orchestration infra and generated-site hosting provisioned
through **Stripe Projects**.

**Start here → [`process.md`](process.md)** — the complete build brief; read it top to
bottom. The visual design bundle is in [`design/`](design/) (read
`design/process/README.md` first).

This is its own repository — not part of the tenwhy design-doc site.
