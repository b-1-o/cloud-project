# ADR 0002: Durable Objects, D1, KV, Queues, and optional analytics

Status: Accepted for the portfolio MVP.

Durable Objects are the coordination point for each live document. They provide strong single-room serialization and WebSocket Hibernation without operating a separate Redis cluster. SQLite storage is colocated with each room and holds update history plus the latest compacted state snapshot.

D1 stores product metadata, workspace/document membership, role definitions, and idempotent audit events. KV is used for brief ticket lookup and feature flags only; authorization truth remains in D1 and the Durable Object's one-time ticket table. Each room periodically compacts updates into a single latest state snapshot in its local SQLite storage.

Neon is reserved for analytics/search workloads, not the synchronous collaboration path. Hyperdrive is the planned pooled connection path from the queue consumer and remains optional. D1 stays the product source of truth so edits do not depend on the analytics database.

Trade-offs: cross-service operations are eventually consistent and consumers must be idempotent. Keeping a single compacted snapshot in room-local storage is sufficient for the portfolio demonstration but does not provide an independent backup copy.
