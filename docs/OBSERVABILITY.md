# Observability and SLOs

## Grafana Cloud

Dashboard created: [Collab Docs — Runtime Signals](https://violetgoldfinch3041.grafana.net/d/collab-docs-runtime).

The dashboard is a useful starting point, not evidence that telemetry is flowing. Its panels currently query the following metric contract and will remain empty until a metrics exporter/remote-write or OTLP pipeline populates the configured Grafana Prometheus data source:

| Signal | Contract | Intent |
| --- | --- | --- |
| Active WebSocket connections | `ws_connections_active` | Number of connected clients |
| CRDT updates/sec | `crdt_updates_per_sec` | Accepted collaboration updates per second |
| Sync lag | `sync_lag_ms` | Update receipt-to-broadcast lag, target < 500 ms |
| DO hibernation events | `do_hibernation_events` | Count of hibernation/resume events |
| Queue depth | `queue_depth` | Pending messages, including DLQ monitored separately |
| API latency | `http_request_duration_seconds_bucket` | p95 target < 300 ms |
| API error rate | `http_requests_total` grouped by status | 5xx ratio target < 1% |

The Worker enables Cloudflare Workers Observability and emits structured JSON request, error, collaboration, snapshot and queue logs. Cloudflare's native OpenTelemetry export is the recommended path to forward Worker traces/logs to an OTLP-compatible destination; configure the endpoint, authentication header, and dataset in the Cloudflare dashboard. Keep all tokens as Worker/GitHub secrets and never attach them to client builds. Define counters/histograms with bounded labels (route template, outcome); do not label metrics by document ID, user ID, email, or raw path because that creates high cardinality and may leak personal information.

## SLO definitions

- Availability >= 99.5% over a rolling 30-day window.
- API p95 < 300 ms.
- Collaboration sync lag < 500 ms.
- HTTP error rate < 1%.

These are objectives, not measured results. Configure recording rules and alerting rules only after the exporter names and scrape/write path are verified. Suggested initial pending durations: 5 minutes for p95 and sync lag; 10 minutes for error rate and availability. Route page-worthy critical notifications to a user-configured contact point (for example, a webhook endpoint) after verifying its secret and delivery test. No Telegram/Discord webhook has been configured here.

## Sentry

The frontend and Worker SDKs are wired to optional DSN environment variables. To activate:

- Create a Sentry project in your own Sentry account and add Worker secret `SENTRY_DSN` plus Pages build environment variable `NEXT_PUBLIC_SENTRY_DSN`.
- Set GitHub Actions secrets `SENTRY_AUTH_TOKEN`, and variables `SENTRY_ORG` / `SENTRY_PROJECT` for source-map upload.
- Add project alert rules in Sentry UI and verify with a deliberate test event before claiming error tracking is active.

A Sentry MCP connector was not available in this workspace, so no Sentry project or alert was created on your behalf.
