# Deployment Report — Collab Docs

Last updated: 2026-10-14

## Current status

- Repository: `b-1-o/cloud-project`, default branch `main`.
- CI on commit `3d1e29f17421ecf5c868781f6515879d80ed3578`: passed dependency install, TypeScript, unit tests, Playwright E2E and production build.
- Remote D1: `0001_init.sql` is recorded in `d1_migrations`; seven app tables, seeded roles and three indexes verified using `sqlite_master` queries.
- Cloudflare resources: KV, Queues and Pages project exist. At last check, no production Worker script and no Pages deployment were present.
- Authentication: Auth0 Free recommended and documented; tenant-specific configuration and login verification remain pending.
- Observability: Grafana dashboard exists, but app metrics are not flowing. Sentry requires an actual project/DSN to become active.
- Analytics: Neon project exists; Hyperdrive is optional and not yet configured.
- Costs: no paid plan or subscription was intentionally enabled during this work.

## Work log

1. Inspected repository and live Cloudflare resources using read-only calls.
2. Removed external snapshot-storage binding and its outbox/retry code; document compaction remains local to Durable Object SQLite.
3. Removed references to the former external snapshot-storage option from the README, deployment runbook, storage ADR, architecture diagram, and Wrangler config.
4. Verified that the D1 migration journal and application schema were already present. A further attempt to run the SQL directly stopped at `table users already exists`; no force/recreate operation was performed. Follow-up read-only checks confirmed the migration record and expected schema.
5. Chose Auth0 Free as the lowest-change OIDC fit. Real tenant values are not fabricated and still need to be entered in the provider and repository settings.
6. Updated the deploy workflow to validate Cloudflare and OIDC secrets before touching D1, then transfer OIDC settings into production Worker secrets through Wrangler stdin. It also validates the Pages callback URI and API audience.
7. Deployment remains gated until the account's Worker URL, Auth0 tenant, GitHub variables and GitHub secrets are configured. No live Worker or Pages deployment is claimed yet.

## Required next actions

1. Create/configure Auth0 SPA and API (public client + PKCE, callback `https://collab-docs-4tb.pages.dev/`, audience `https://collab-docs-api`).
2. Enable the account's `workers.dev` subdomain through Cloudflare Dashboard, then determine the real production Worker URL.
3. Store the required GitHub Actions secrets and repository variables as documented in `docs/DEPLOYMENT.md`.
4. Run CI to green on the latest commit, then enable deployment and run the deploy workflow.
5. Verify health endpoint, successful/failed JWT cases, viewer read-only behavior, two-client WebSocket sync, and production Pages rendering.
