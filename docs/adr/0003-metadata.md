# ADR 0003: D1 for product metadata; Neon for analytics

Status: Accepted.

D1 is the authority for users, workspaces, documents, roles, and audit events because this app's API and room coordination are Cloudflare-native. Neon provides PostgreSQL capabilities for analytical queries and full-text/search experiments that should not add latency to an edit's critical path. Hyperdrive pools the asynchronous consumer connection when configured.

We avoid dual-writing both databases in the request handler. The queue consumer is the only planned analytics writer, uses event IDs for idempotency, and can retry independently. If analytics storage is down, document editing should remain available. Operational cost and consistency complexity are the price of this split; for a tiny MVP, D1 alone would be simpler.
