# Collab Docs

A real-time collaborative document editor built on a Cloudflare-first architecture. This repository is an MVP scaffold; deployment, production identity, and external observability are not claimed as complete until verified.

## MVP slice

- Rich-text editor powered by Tiptap and Yjs.
- Offline local edits via IndexedDB; WebSocket room synchronization through a SQLite-backed Durable Object using the WebSocket Hibernation API.
- D1 metadata, workspace/document roles, idempotent audit events, short-lived WebSocket tickets in KV, R2 snapshot bindings, and a Queue consumer.
- Type checks, unit tests, CI/CD templates, ADRs, and a k6 smoke scenario.

## Architecture

Browser (Next.js static export) -> Cloudflare Pages -> Worker API -> D1 metadata + KV ticket cache + one Durable Object per document. The Durable Object persists CRDT updates in SQLite, broadcasts updates, snapshots periodically to R2, and emits idempotent events to Cloudflare Queues. The consumer records audit events and has an optional Neon analytics path through Hyperdrive. Structured logs go to Cloudflare Workers Observability; Grafana OTLP and Sentry exports need account-side credentials and setup.

See [the runtime dashboard](https://violetgoldfinch3041.grafana.net/d/collab-docs-runtime), docs/architecture.mmd, docs/adr/, docs/AUTH.md, docs/OBSERVABILITY.md, and docs/TESTING.md.

## Local development

Requirements: Node.js 22+, pnpm 10+.

1. Run `pnpm install`.
2. Run `pnpm --filter backend exec wrangler d1 migrations apply collab-docs-db --local --config wrangler.jsonc`.
3. Run `pnpm --filter backend dev`.
4. In another terminal run `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter frontend dev`.

Local demo identity is allowed only while ENVIRONMENT is not production. Production requests fail closed unless OIDC/JWKS settings are configured.

## Deployment checklist

- The IDs in backend/wrangler.jsonc are placeholders until D1, KV, and Queues are provisioned.
- Enable R2 for the Cloudflare account before creating the snapshots bucket.
- Configure AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE and all platform credentials as secrets/vars; do not commit tokens.
- GitHub Actions runs type checks, tests, and the frontend build. The deploy workflow requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets.
- The Pages workflow expects `frontend/out`. Set the repository variable NEXT_PUBLIC_API_URL to the deployed Worker URL.

## Security, reliability, and honest status

JWTs are verified against configured remote JWKS, issuer, and audience. Production without identity settings is denied. All document access is checked against workspace roles; viewers are read-only. WebSocket tickets expire quickly and a SQLite-backed guard prevents replay. Queue events have deterministic IDs and audit inserts are idempotent.

The local demo identity is not suitable for public deployments. Add an OIDC login flow before inviting external users. Free plans have quotas and limits that can change. Targets such as availability >= 99.5%, API p95 < 300 ms, sync lag < 500 ms, and error rate < 1% are SLO intentions, not measured results. No Grafana dashboard, Sentry project, load-test results, or public demo is claimed until created and verified.

## Trade-offs

Yjs CRDTs handle concurrent and offline edits without a central transform pipeline, at the cost of extra metadata and compaction needs. Durable Objects coordinate each room without a separate Redis cluster. D1 owns product metadata; Neon is optional analytics only. R2 is intended for binary snapshots and exports. KV is a short-lived cache, not an authorization source.

See MIT LICENSE.
