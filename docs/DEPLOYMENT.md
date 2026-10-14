# Deployment runbook

## Current resource status

This section records the last read-only inspection; it is not a claim that the application is deployed.

- D1 database `collab-docs-db` is schema-initialized. SQL inspection verified `0001_init.sql` in `d1_migrations`, all seven application tables, the three seeded roles, and three expected indexes. The D1 list endpoint's `num_tables` summary did not match SQL-catalog results, so the catalog and migration journal were used for verification.
- KV namespace `collab-docs-flags` exists.
- Queues `document-events` and `document-events-dlq` exist.
- Pages project `collab-docs` exists at `https://collab-docs-4tb.pages.dev`, but it has no deployment yet.
- No production Worker script was deployed at the time of inspection.
- The account did not yet have a `workers.dev` subdomain, so the public Worker URL must be resolved before setting `NEXT_PUBLIC_API_URL`.
- The Neon project `collab-docs-analytics` exists. A Hyperdrive configuration has not been created; analytics remains optional.

The D1, KV, Queue and Durable Object bindings are recorded in `backend/wrangler.jsonc`. Local defaults use demo auth, while `--env production` uses OIDC. Production requests fail closed until the identity provider settings are configured. The deployment workflow remains gated by `CLOUDFLARE_DEPLOY_ENABLED=true`.

## Document snapshots

Each `DocumentRoom` Durable Object stores Yjs updates in its SQLite storage. After 100 persisted updates, it writes the latest encoded document state into the room's local `doc_snapshots` table and removes the compacted update rows. The room retains one latest compacted snapshot locally; there is no separate archive or off-site backup. This is acceptable for a portfolio demo but is not a production backup strategy.

## OIDC setup

Auth0 Free is the selected provider for the existing generic OIDC/PKCE client. Create a Single Page Application (public client) and an API whose identifier is exactly `https://collab-docs-api`. Register `https://collab-docs-4tb.pages.dev/` as an allowed callback URL and allow the exact Pages origin for browser token exchange. Do not create or use a browser client secret.

The tenant-specific URLs are not known until the tenant is created. For a standard Auth0 tenant they follow these forms, with the tenant domain replacing `YOUR_TENANT_DOMAIN`:

- Authorization URL: `https://YOUR_TENANT_DOMAIN/authorize`
- Token URL: `https://YOUR_TENANT_DOMAIN/oauth/token`
- Issuer: `https://YOUR_TENANT_DOMAIN/`
- JWKS URL: `https://YOUR_TENANT_DOMAIN/.well-known/jwks.json`
- Audience: `https://collab-docs-api`

Before deployment, validate that the API's access token has that audience and the tenant's exact issuer. Never put a client secret in frontend variables or source control.

## GitHub Actions settings

Set the following **repository variables** after the actual Worker URL and Auth0 tenant are known:

- `CLOUDFLARE_DEPLOY_ENABLED=true`
- `NEXT_PUBLIC_API_URL` = the actual deployed Worker URL
- `NEXT_PUBLIC_OIDC_AUTHORIZATION_URL`
- `NEXT_PUBLIC_OIDC_TOKEN_URL`
- `NEXT_PUBLIC_OIDC_CLIENT_ID`
- `NEXT_PUBLIC_OIDC_REDIRECT_URI=https://collab-docs-4tb.pages.dev/`
- `NEXT_PUBLIC_OIDC_AUDIENCE=https://collab-docs-api`
- Optional: `NEXT_PUBLIC_OIDC_SCOPES=openid profile email`, `NEXT_PUBLIC_SENTRY_DSN`

Set these **repository secrets**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AUTH_JWKS_URL`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE=https://collab-docs-api`
- Optional for Sentry source-map uploads: `SENTRY_AUTH_TOKEN`

The deploy workflow validates required secrets before running a migration or deploying. After deploying the Worker, it passes the three OIDC values into Wrangler via stdin to set Worker secrets without printing values to logs.

## Deploy and verify

The remote migration journal already records `0001_init.sql`; a deployment run should therefore report no pending migration. From the repository root, CI runs `pnpm install`, `pnpm typecheck`, `pnpm test`, the Playwright E2E suite, and `pnpm build`.

Once the identity provider, GitHub secrets, repository variables, and Worker subdomain are configured, enable the deployment opt-in and run the deploy workflow. It applies pending migrations, deploys the Worker, configures Worker secrets, builds the static frontend with the public OIDC values, then deploys Pages. Validate the production login, JWT rejection/acceptance, viewer write rejection, and ticket-based WebSocket connection before claiming the app is live.

## Remaining integrations

Grafana has a dashboard but custom application metrics are not yet flowing. Sentry is present in code but requires a real DSN/project to enable. Neon analytics is optional and does not block the main document API; configure it only if wanted, then provision its connection through Cloudflare's Hyperdrive settings without putting database credentials in source or logs.
