# Claude Outcome Handoff

Use this prompt to brief Claude on what changed and what was verified:

```text
We finalized the custombasketball-poc interaction loop.

Architecture now:
- Maestro runs on Render and stores durable job/result state in Neon Postgres.
- Nic and Max each run as separate Blaxel sandbox jobs via the signed job contract and webhook.
- The shared Blaxel image is Node 20 + Chromium + both CLI bundles.
- Nic uses Kimi K2.7 Code to generate a compact custombasketball storefront content/design spec, validates it, renders a static HTML/CSS site with 5 jerseys, and deploys it to Railway.
- Max audits the Railway URL with Lighthouse, then uses Kimi K2.7 Code to produce a constrained SEO/code proposal.
- Maestro uses OpenAI gpt-5.5 with high reasoning to evaluate Max's proposal before acknowledging the handoff. It evaluates only; applying fixes is intentionally out of scope.

Key implementation details:
- Shared AI client lives in app/shared/ai.ts.
- Nic implementation is app/tools/nic/index.ts.
- Max implementation is app/tools/max/index.ts.
- Maestro orchestration/evaluation is app/server/maestro.ts.
- Live Process Steps page is app/web/index.html, app/web/flow.jsx, and app/web/stages.jsx.
- Railway deploy now uses attached `railway up --json`, not detached deploy, because detached deploy returned a domain before the app was attached and caused repeated Railway 404s.
- Nic also has a 5s per-request readiness timeout so a hanging domain probe cannot block forever.

Verified run:
- Run ID: d250a041-0349-4bb7-9008-0c519667505c
- Nic job: succeeded
- Max job: succeeded
- Generated URL: https://cb26940d39b899-production.up.railway.app
- Max SEO score: 92
- Max finding: canonical link was relative (`/`) instead of an absolute self-referencing URL.
- Maestro decision: revise
- Maestro accepted the canonical, social metadata, and Organization JSON-LD changes, but rejected/revised the robots.txt sitemap reference because the proposal did not also create sitemap.xml.

Remaining caveats:
- Render paid plan provisioning still failed through Stripe Projects, so the service is manually kept warm rather than truly paid always-on.
- Railway hosting was not completed through Stripe Projects; the verified path uses a manually configured Render RAILWAY_API_TOKEN.
- Stripe Projects failure details are in docs/stripe-projects-failure-report.md.
```
