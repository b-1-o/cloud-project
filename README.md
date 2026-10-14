# Collab Docs

A real-time collaborative document editor built on a Cloudflare-first architecture. This repository is an MVP scaffold; deployment, production identity, and external observability are not claimed as complete until verified.

## MVP slice

- Rich-text editor powered by Tiptap and Yjs.
- Offline local edits via IndexedDB; WebSocket room synchronization through a SQLite-backed Durable Object using the WebSocket Hibernation API.
- D1 metadata, workspace/document roles, idempotent audit events, short-lived WebSocket tickets in KV, and a Queue consumer.
- Periodic compaction keeps the latest document snapshot in Durable Object SQLite. Optional R2 archival is intentionally disabled for this portfolio project; no R2 subscription or bucket is required.
- Type checks, unit tests, CI/CD templates, ADRs, and a k6 smoke scenario.

## Architecture

Browser (Next.js static export) -> Cloudflare Pages -> Worker API -> D1 metadata + KV ticket cache + one Durable Object per document. Each Durable Object persists Yjs updates in SQLite, compacts them into its latest SQLite snapshot, broadcasts updates, and emits idempotent events to Cloudflare Queues. R2 archival is not configured, so snapshots stay in the Durable Object's own storage rather than being copied to a separate object store. The consumer records audit events and has an optional Neon analytics path through Hyperdrive. Structured logs go to Cloudflare Workers Observability; Grafana OTLP and Sentry exports need account-side credentials and setup.

See [the runtime dashboard](https://violetgoldfinch3041.grafana.net/d/collab-docs-runtime), docs/architecture.mmd, docs/adr/, docs/AUTH.md, docs/OBSERVABILITY.md, and docs/TESTING.md.

## Local development

Requirements: Node.js 22+, pnpm 10+.

1. Run `pnpm install`.
2. Run `pnpm --filter backend exec wrangler d1 migrations apply collab-docs-db --local --config wrangler.jsonc`.
3. Run `pnpm --filter backend dev`.
4. In another terminal run `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter frontend dev`.

Local demo identity is allowed only while ENVIRONMENT is not production. Production requests fail closed unless OIDC/JWKS settings are configured.

## Deployment checklist

- D1, KV, and Queue IDs are provisioned in `backend/wrangler.jsonc`. R2 is intentionally not bound or enabled; its subscription is not required for the portfolio deployment.
- The remote D1 database still needs its schema migration before the API can be used. Applying remote migrations changes Cloudflare state and should be done deliberately.
- Configure AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE and all platform credentials as secrets/vars; do not commit tokens.
- GitHub Actions runs type checks, unit tests, Playwright smoke tests, and the frontend build. Deployment requires the opt-in variable `CLOUDFLARE_DEPLOY_ENABLED=true`, the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, plus the API URL and OIDC build variables described in docs/DEPLOYMENT.md.
- The Pages workflow expects `frontend/out`. Set the repository variable NEXT_PUBLIC_API_URL to the deployed Worker URL.

## Security, reliability, and honest status

JWTs are verified against configured remote JWKS, issuer, and audience. Production without identity settings is denied. All document access is checked against workspace roles; viewers are read-only. WebSocket tickets expire quickly and a SQLite-backed guard prevents replay. Queue events have deterministic IDs and audit inserts are idempotent.

The local demo identity is not suitable for public deployments. Configure the OIDC provider using docs/AUTH.md before inviting external users. Free plans have quotas and limits that can change. Targets such as availability >= 99.5%, API p95 < 300 ms, sync lag < 500 ms, and error rate < 1% are SLO intentions, not measured results. A Grafana dashboard exists, but custom metrics are not yet being exported. No Sentry project, measured load-test result, or published application deployment is claimed until verified.

## Trade-offs

Yjs CRDTs handle concurrent and offline edits without a central transform pipeline, at the cost of extra metadata and compaction needs. Durable Objects coordinate each room without a separate Redis cluster. D1 owns product metadata; Neon is optional analytics only. The current portfolio setup keeps the latest compacted snapshot in Durable Object SQLite and has no external snapshot archive or off-site backup. R2 can be added later if archival storage is approved. KV is a short-lived cache, not an authorization source.

See MIT LICENSE.
