# ADR 0002: Durable Objects, D1, KV, Queues, and optional analytics

Status: Accepted for the portfolio MVP; external R2 archival is intentionally omitted.

Durable Objects are the coordination point for each live document. They provide strong single-room serialization and WebSocket Hibernation without operating a separate Redis cluster. SQLite storage is colocated with each room and holds update history plus the latest compacted state snapshot.

D1 stores product metadata, workspace/document membership, role definitions, and idempotent audit events. R2 could be used for larger binary snapshots and exports, but no R2 binding, bucket, or subscription is configured in this portfolio setup. KV is used for brief ticket lookup and feature flags only; authorization truth remains in D1 and the Durable Object's one-time ticket table.

Neon is reserved for analytics/search workloads, not the synchronous collaboration path. Hyperdrive is the planned pooled connection path from the queue consumer and remains optional. D1 stays the product source of truth so edits do not depend on the analytics database.

Trade-offs: cross-service operations are eventually consistent and consumers must be idempotent. Without R2, each room keeps only its latest compacted snapshot in its Durable Object SQLite storage; there is no separate object-store archive or off-site snapshot backup. This is an explicit cost-saving choice for a portfolio demo, not a production backup guarantee. R2 can be added later if separately approved and if a retention/recovery policy is defined.
