# Vixiny

A real-time document workspace built on a Cloudflare-first architecture. Vixiny brings document editing, collaboration, workspace activity, review tools, hand-drawn signatures, and file imports into one place. Production integrations still require the account-side setup described below.

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

- The default Personal workspace home is focused on recently used documents and the Gmail attachment inbox. Workspace Hub is a separate destination under the WORKSPACE sidebar heading; it contains shared documents, discussion, calendar, project briefs, recent edits, and the live library summary.
- The document inspector is aligned to the right edge and contains review, signature, and export actions; formatting stays in the single editor toolbar.
- Import creates a new document without replacing an existing one. Scanned and selectable-text PDFs, plus legacy binary Word `.doc` files, are preserved byte-for-byte as original file attachments; PDFs open in the integrated PDF.js canvas with theme-aware controls for zoom, drawing, text annotations, signature placement, and saving an annotated copy back to the original document. Signed-in originals are stored in chunked Durable Object SQLite file blobs; local originals are stored in IndexedDB. Original-file uploads are limited to 30 MB per document. Files with formats that do not have an extractor are still imported as original files and can be downloaded or opened in a compatible desktop app. Editable content extraction includes DOCX/DOCM, ODT/ODS/ODP, XLSX/XLSM, PPTX/PPTM, RTF, HTML, Markdown, EPUB, TXT, CSV, TSV, JSON, XML, LOG, YAML, and YML, with a 1.8 MB extracted-content limit.
- Formats that use content extraction become editable text/rich-text representations and do not preserve every original layout, image, chart, formula, animation, font, or embedded object. PDFs are not passed through text extraction or OCR: they remain the original PDF, including scanned/image-only pages. Legacy binary XLS/PPT and Apple iWork files without a content extractor are retained as original files; convert them first only when you need their contents editable inside Vixiny. PDF annotations and signatures are flattened into the saved PDF; existing PDF text is not yet directly editable. This is not yet a native-fidelity replacement for Word, Excel, or PowerPoint.
- Hand-drawn signatures can be inserted at the current editor cursor in rich-text documents, or placed on a PDF page and saved together with annotations. A touch screen or stylus supports direct drawing; a standard laptop trackpad uses the browser's press-and-drag pointer input.


## Privacy

See [the Vixiny privacy notice](/privacy) for details about local documents, workspace storage, Gmail access, and imported files.

## Trade-offs

Yjs CRDTs handle concurrent and offline edits without a central transform pipeline, at the cost of extra metadata and compaction needs. Durable Objects coordinate each room without a separate Redis cluster. D1 owns product metadata; Neon is optional analytics only. The current portfolio setup keeps the latest compacted snapshot in Durable Object SQLite. KV is a short-lived cache, not an authorization source.

See MIT LICENSE.
