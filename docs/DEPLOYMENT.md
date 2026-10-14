# Deployment runbook

## Current resource status

This section records the last read-only account inspection; it is not a claim that the application is deployed.

- D1 database `collab-docs-db` exists, but the remote database reported zero tables. Its migration has **not** been applied.
- KV namespace `collab-docs-flags` exists.
- Queues `document-events` and `document-events-dlq` exist.
- Pages project `collab-docs` exists at `https://collab-docs-4tb.pages.dev`, but it has no deployment yet.
- No Worker script was deployed at the time of inspection.
- Neon project `collab-docs-analytics` exists. A Cloudflare Hyperdrive configuration has not been created, so the optional analytics connection is not active.
- R2 is intentionally **not enabled or bound**. No R2 subscription or bucket is needed for the current portfolio deployment.

The D1, KV, Queue and Durable Object bindings are recorded in `backend/wrangler.jsonc`. Local defaults use demo auth, while `--env production` uses OIDC. Production requests fail closed until the identity provider settings are configured. The deployment workflow remains gated by `CLOUDFLARE_DEPLOY_ENABLED=true`.

## Snapshot behavior without R2

Each `DocumentRoom` Durable Object stores document updates in its SQLite storage. After 100 persisted updates, it writes the latest Yjs state to the room's local `doc_snapshots` table and prunes the compacted update rows. With R2 absent, that latest snapshot remains only in Durable Object SQLite: there is no separate object-store archive or off-site snapshot copy. This is adequate for a portfolio demo but should not be described as a production backup strategy. R2 is an optional future enhancement and is deliberately excluded to avoid an additional subscription and usage billing.

## One-time secrets and settings

1. Create a scoped Cloudflare API token and add GitHub repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never commit token values or paste them into source files.
2. Configure Worker secrets `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE` for the identity provider. Do not use demo mode in production.
3. Add GitHub Actions variables `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_AUTHORIZATION_URL`, `NEXT_PUBLIC_OIDC_TOKEN_URL`, `NEXT_PUBLIC_OIDC_CLIENT_ID`, `NEXT_PUBLIC_OIDC_REDIRECT_URI`, and `NEXT_PUBLIC_OIDC_AUDIENCE`. Register `https://collab-docs-4tb.pages.dev/` as the redirect URI in the identity provider. Set `FRONTEND_ORIGIN=https://collab-docs-4tb.pages.dev` and the Worker JWKS URL, issuer and audience to match.
4. Configure Hyperdrive to Neon only if the analytics path is wanted. Create it through Cloudflare Dashboard and avoid echoing the privileged database URI in logs. Hyperdrive is optional for the main app path.
5. Configure a Sentry project/DSN or Grafana OTLP credentials only if those external telemetry integrations are to be activated. For GitHub deployment set Actions variable `CLOUDFLARE_DEPLOY_ENABLED=true`; without this opt-in, deploy jobs are skipped. Sentry source-map uploads additionally need `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`.

## Deploy

From the repository root run `pnpm install`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. The remote D1 migration is a state-changing operation; confirm before applying it to the live database. The current schema must be applied before the Worker is useful. After auth configuration and environment variables are verified, deploy the Worker with `pnpm --filter backend deploy` and the static export with `pnpm --filter backend exec wrangler pages deploy ../frontend/out --project-name collab-docs`.

The GitHub Actions workflow is gated by `CLOUDFLARE_DEPLOY_ENABLED=true` and requires valid Cloudflare secrets and repository variables. Confirm deployment status and test two separate browser sessions before sharing the app. Do not claim a published deployment until a successful deployment is visible in Cloudflare.
