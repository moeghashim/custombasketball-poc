# Stripe Projects Provisioning Failure Report

Report date: June 15, 2026

Project: `custombasketball-poc`

Current verified outcome: the POC works end to end after manual workarounds, except Render is still on a Free instance because paid plan selection through Stripe Projects failed. A verified run on June 15, 2026 (`d250a041-0349-4bb7-9008-0c519667505c`) created the generated Railway preview `https://cb26940d39b899-production.up.railway.app`, Max returned a Lighthouse SEO score of 92, and Maestro evaluated Max's Kimi proposal with OpenAI `gpt-5.5` high reasoning.

Current generated-site host direction: the codebase targets Railway for generated-site hosting. Railway appears in the Stripe Projects catalog as `railway/hosting`, but the `generated-site-host` resource is still `needs_information`, and Stripe Projects has not emitted Railway credentials into `stripe projects env`. The verified run used a manually configured Render `RAILWAY_API_TOKEN`.

## Issues

### Render env vars were not usable after provisioning

Observed: Render booted without `DATABASE_URL` or `NEON_CONNECTION_STRING`, then `pg` fell back to localhost and crashed with `ECONNREFUSED 127.0.0.1:5432`.

Impact: the deployed Maestro could not start until env vars were manually copied into Render.

Workaround: manually imported the Stripe Projects `.env` values into Render and added explicit runtime overrides.

Requested fix: Stripe Projects should either inject linked resource env vars into Render automatically or provide a one-command, provider-aware env sync for Render services.

### Render paid plan could not be selected through Stripe Projects

Observed: the Render catalog exposed paid `starter` pricing, but the `render/web-service` config schema did not accept `instance_type`. A full config update with `instance_type: starter` returned a Stripe API 500 (`req_v2xhb17Ls4iRcpo91`); a narrow update was rejected as invalid schema.

Impact: the service remains on Render Free, which can spin down and delay one-button demos. This is the only open blocker for the "always-on Maestro" success criterion.

Workaround: continued on Free for the POC and added a GitHub Actions keep-warm workflow that pings `/health` every five minutes. This reduces cold-start risk for demos but does not replace a paid always-on Render instance.

Requested fix: expose Render plan/instance configuration in the schema and return a validation error instead of a 500 when unsupported config is submitted.

### Blaxel service-account API key provisioned by Stripe Projects returned 401

Observed: the Stripe-provisioned Blaxel workspace, service account, and API key existed in Blaxel, but the original and rotated Stripe Projects keys returned 401 through both Blaxel CLI/API flows. Browser OAuth login to the same workspace worked, proving the workspace was accessible.

Impact: Render could not create Blaxel sandboxes with the Stripe-provisioned key.

Workaround: used Blaxel OAuth as an admin to create a new service-account API key through Blaxel's service-account API, verified it with the CLI/API, and configured Render with that key as `BL_API_KEY`.

Requested fix: ensure Stripe Projects-created Blaxel service-account keys are granted the permissions required to list images, create sandboxes, and execute sandbox processes; expose key/role health in Stripe Projects status.

### Daytona API URL exported by Stripe Projects was internal-only

Observed: Stripe Projects exported a Daytona API URL on the internal hostname `daytona-api`. That hostname resolved nowhere from the Blaxel worker, producing `getaddrinfo ENOTFOUND daytona-api` during Nic's Daytona sandbox creation.

Impact: cross-provider workers could not call Daytona even with a valid Daytona API key.

Workaround: changed Maestro normalization to drop that internal Daytona API URL so the Daytona SDK falls back to its public default API URL.

Requested fix: export a public Daytona API URL for cross-provider workloads, or clearly mark internal-only URLs so orchestrators do not pass them into external workers.

### Railway hosting resource could not be completed through Stripe Projects

Observed: `stripe projects add railway/hosting --name generated-site-host --json --yes --accept-tos` created a Railway provider/resource, but returned `INFORMATION_REQUIRED` asking for `source_type`. The GitHub repository path then asked for repository and branch details, which does not match this POC's per-run generated-site artifact flow. The Docker image path failed with `Not logged in with a live mode account. Please run stripe login or set STRIPE_API_KEY.` `stripe projects env --refresh --json` did not return any Railway token or project env vars.

Impact: Maestro and Nic can deploy generated sites to Railway when a Railway token is configured manually, but Stripe Projects has not yet provided the credential needed for Render/Blaxel to run that path end to end without manual setup.

Workaround: configure a Railway token manually in Render as `RAILWAY_API_TOKEN` for account/workspace project creation, or `RAILWAY_TOKEN` plus optional `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, and `RAILWAY_ENVIRONMENT_ID` for an existing Railway project/service.

Requested fix: make `railway/hosting` provisioning support API-driven generated artifacts or clearly document the required source model; emit the created Railway credentials through `stripe projects env`; and make live-mode/payment requirements explicit before resource creation.

## References

- Render Free web services spin down after 15 minutes of no inbound traffic and show a loading page while spinning up: https://render.com/docs/free#spinning-down-on-idle
- Blaxel custom sandbox images require `sandbox-api` for process/file operations: https://docs.blaxel.ai/Sandboxes/Templates
- Blaxel service-account API keys: https://docs.blaxel.ai/api-reference/service_accounts/create-service-account-api-key
- Daytona SDK default API URL and env configuration: https://www.daytona.io/docs/en/configuration/
- Railway CLI project token and account token environment variables: https://docs.railway.com/cli
- Railway CLI `railway up` deployment flow: https://docs.railway.com/cli/deploying
- Railway public domains: https://docs.railway.com/networking/public-networking
