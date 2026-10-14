# Testing strategy

## Automated checks

- Unit: `pnpm test` (RBAC/title boundaries and Yjs concurrent/offline merge).
- Browser smoke: `pnpm test:e2e` uses Playwright, mocks the API surface, and verifies the workspace-to-editor happy path.
- Build/type safety: `pnpm typecheck` and `pnpm build`.
- Load smoke: install k6 and run `BASE_URL=https://<worker-host> k6 run infra/load/collab-docs.js`. To exercise the authenticated documents endpoint, provide a short-lived test token through `AUTH_TOKEN`; don't use a personal production token or put it in source control.

## Missing production-grade test stages

A full integration test must run against a disposable Cloudflare environment with a migrated D1 database, the deployed Durable Object, KV, Queue, and two concurrent WebSocket clients. Run it only after account setup and do not test against production data. The current Playwright smoke test is not a substitute for concurrent multi-client integration coverage. No load-test result is reported because no deployment has been benchmarked.
