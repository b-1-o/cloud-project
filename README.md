# Collab Docs

A real-time document workspace built on a Cloudflare-first architecture. CollabDocs brings document editing, collaboration, workspace activity, review tools, hand-drawn signatures, and file imports into one place. Production integrations still require the account-side setup described below.

## MVP slice

- Rich-text editor powered by Tiptap and Yjs.
- Offline local edits via IndexedDB; WebSocket room synchronization through a SQLite-backed Durable Object using the WebSocket Hibernation API.
- D1 metadata, workspace/document roles, idempotent audit events, short-lived WebSocket tickets in KV, and a Queue consumer.
- Periodic compaction keeps the latest document snapshot in Durable Object SQLite.
- Type checks, unit tests, CI/CD templates, ADRs, and a k6 smoke scenario.

## Architecture

Browser (Next.js static export) -> Cloudflare Pages -> Worker API -> D1 metadata + KV ticket cache + one Durable Object per document. Each Durable Object persists Yjs updates in SQLite, compacts them into its latest SQLite snapshot, broadcasts updates, and emits idempotent events to Cloudflare Queues. The consumer records audit events and has an optional Neon analytics path through Hyperdrive. Structured logs go to Cloudflare Workers Observability; Grafana OTLP and Sentry exports need account-side credentials and setup.

See [the runtime dashboard](https://violetgoldfinch3041.grafana.net/d/collab-docs-runtime), docs/architecture.mmd, docs/adr/, docs/AUTH.md, docs/OBSERVABILITY.md, and docs/TESTING.md.

## Local development

Requirements: Node.js 22+, pnpm 10+.

1. Run `pnpm install`.
2. Run `pnpm --filter backend exec wrangler d1 migrations apply collab-docs-db --local --config wrangler.jsonc`.
3. Run `pnpm --filter backend dev`.
4. In another terminal run `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter frontend dev`.

Local demo identity is allowed only while ENVIRONMENT is not production. Production requests fail closed unless OIDC/JWKS settings are configured.

## Deployment checklist

- D1, KV, and Queue IDs are provisioned in `backend/wrangler.jsonc`.
- The remote D1 schema has been verified: `d1_migrations` records `0001_init.sql`, and the seven application tables, role seed rows, and three indexes are present.
- Store `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, and Cloudflare deployment credentials as GitHub Actions secrets. The deployment workflow uploads the OIDC values to production Worker secrets only after validation; never commit secrets.
- GitHub Actions runs type checks, unit tests, Playwright smoke tests, and the frontend build. Deployment requires the opt-in variable `CLOUDFLARE_DEPLOY_ENABLED=true`, the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, plus the API URL and OIDC build variables described in docs/DEPLOYMENT.md.
- The Pages workflow expects `frontend/out`. Set the repository variable NEXT_PUBLIC_API_URL to the deployed Worker URL.

## Security, reliability, and honest status

JWTs are verified against configured remote JWKS, issuer, and audience. Production without identity settings is denied. All document access is checked against workspace roles; viewers are read-only. WebSocket tickets expire quickly and a SQLite-backed guard prevents replay. Queue events have deterministic IDs and audit inserts are idempotent.

The local demo identity is not suitable for public deployments. Configure the OIDC provider using docs/AUTH.md before inviting external users. Free plans have quotas and limits that can change. Targets such as availability >= 99.5%, API p95 < 300 ms, sync lag < 500 ms, and error rate < 1% are SLO intentions, not measured results. A Grafana dashboard exists, but custom metrics are not yet being exported. No Sentry project, measured load-test result, or published application deployment is claimed until verified.


## Workspace product features

- The Workspace Hub is the default home view, including shared documents, discussion, calendar, project briefs, recent edits, a live library summary, and a recently used list.
- The document inspector stays visible beside the page with formatting, review, signature, and export controls.
- Import runs in the browser and creates a new editable document without replacing an existing one. Supported content extraction includes DOCX/DOCM, ODT/ODS/ODP, XLSX/XLSM, PPTX/PPTM, RTF, selectable-text PDF, HTML, Markdown, EPUB, TXT, CSV, TSV, JSON, XML, LOG, YAML, and YML. Imports are limited to 30 MB and 1.8 MB of extracted content per document.
- Imported documents are editable text/rich-text representations. The importer does not preserve every page layout, image, chart, formula, animation, font, or embedded object. Scanned PDFs need OCR; legacy binary DOC/XLS/PPT and Apple iWork formats need conversion before import. This is not yet a native-fidelity replacement for Word, Excel, PowerPoint, or a PDF annotation suite.
- Hand-drawn signatures can be inserted at the current editor cursor. A touch screen or stylus supports direct drawing; a standard laptop trackpad uses the browser's press-and-drag pointer input.

## Gmail attachment inbox

The optional **New from Gmail** panel uses Google's browser Identity Services token client and the Gmail API. It requests only `https://www.googleapis.com/auth/gmail.readonly`, lists recent messages with attachments, and downloads an attachment only after the user selects it. Access tokens are held in page memory and are not sent to the CollabDocs Worker. Imported text then follows the normal document storage and collaboration path. Disconnecting clears the in-page token; reloading the page requires reconnecting.

To configure the integration:

1. Create a Google Cloud project and enable the Gmail API.
2. Create an OAuth Client ID for a Web application.
3. Add the CollabDocs site origin and your local development origin (for example, `http://localhost:3000`) to Authorized JavaScript origins.
4. Configure the OAuth consent screen and add your own account as a test user while developing.
5. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend environment and the Cloudflare Pages build environment, then rebuild the frontend.

Google classifies `gmail.readonly` as a restricted scope. Public release may require Google's restricted-scope verification and, depending on how Gmail-derived content is handled, additional security review. Do not advertise Gmail integration as production-ready until the relevant Google review and privacy requirements are completed. See Google's [Gmail API scope guide](https://developers.google.com/workspace/gmail/api/auth/scopes) and [restricted-scope verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

## Privacy

See [the CollabDocs privacy notice](/privacy) for details about local documents, workspace storage, Gmail access, and imported files.

## Trade-offs

Yjs CRDTs handle concurrent and offline edits without a central transform pipeline, at the cost of extra metadata and compaction needs. Durable Objects coordinate each room without a separate Redis cluster. D1 owns product metadata; Neon is optional analytics only. The current portfolio setup keeps the latest compacted snapshot in Durable Object SQLite. KV is a short-lived cache, not an authorization source.

See MIT LICENSE.
