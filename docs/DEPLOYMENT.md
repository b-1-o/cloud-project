# Deployment runbook

## Cloudflare resources created

- D1 database `collab-docs-db`; schema applied through D1's SQL API.
- KV namespace `collab-docs-flags`.
- Queues `document-events` and `document-events-dlq`.
- Pages project `collab-docs` at `https://collab-docs-4tb.pages.dev` (project is created, no deployment yet).
- Neon project `collab-docs-analytics`, US West 2, PostgreSQL 17; schema is applied.

Resource IDs are recorded in `backend/wrangler.jsonc` after provisioning. The current Cloudflare account API explicitly refused R2 operations because R2 must first be enabled through the dashboard. Do not deploy until the config's R2 binding has been enabled or the optional snapshot path is intentionally disabled. Hyperdrive needs a database origin secret; configure it using the Cloudflare Dashboard so the privileged Neon connection URI is not echoed into tooling logs.

## One-time secrets / settings

1. Open Cloudflare Dashboard > R2 Object Storage and enable R2 for the account. Create the bucket `collab-docs-snapshots`; add a lifecycle policy for old snapshot prefixes only after selecting a retention window. Never delete current snapshots without verified recovery coverage.
2. Create a scoped Cloudflare API token. Add GitHub repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Configure Worker secrets `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE` for your identity provider. Do not use demo mode in production.
4. Build the static site with `NEXT_PUBLIC_API_URL=https://<worker-host>`; set the Worker `FRONTEND_ORIGIN=https://collab-docs-4tb.pages.dev`.
5. Configure Hyperdrive to the Neon database via Dashboard, then add its ID to the Wrangler Hyperdrive binding and add the Postgres client dependency.
6. Configure Sentry project/DSN in its dashboard and Grafana OTLP credentials before claiming external telemetry is live. For GitHub deployment set Actions variable `CLOUDFLARE_DEPLOY_ENABLED=true`; without this opt-in, deploy jobs are skipped. Add `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, and `SENTRY_PROJECT` as repository variables and `SENTRY_AUTH_TOKEN` as a secret if using Sentry source-map uploads.

## Deploy

From repo root: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Apply database migrations before the Worker deploy. Deploy with `pnpm --filter backend exec wrangler deploy --config wrangler.jsonc`; deploy `frontend/out` with `pnpm --filter backend exec wrangler pages deploy ../frontend/out --project-name collab-docs`.

The GitHub Actions workflow is a template and requires valid secrets and real binding IDs. Confirm Cloudflare deployment status and test two separate browser sessions before sharing the app.
