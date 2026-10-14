# ADR 0002: Durable Objects, D1, R2, KV, and Neon

Status: Accepted for the MVP.

Durable Objects are the coordination point for each live document. They provide strong single-room serialization and WebSocket Hibernation without operating a separate Redis cluster. SQLite storage is colocated with the room and keeps update history and one recent state snapshot.

D1 stores product metadata, workspace/document membership, role definitions, and idempotent audit events. R2 is intended for larger binary snapshots and exports, which should not live in relational rows. KV is used for brief ticket lookup and feature flags only; authorization truth remains in D1 and the Durable Object's one-time ticket table.

Neon is reserved for analytics/search workloads, not the synchronous collaboration path. Hyperdrive is the planned pooled connection path from the queue consumer. D1 remains product source-of-truth so edits do not depend on the analytics database.

Trade-offs: cross-service operations are eventually consistent and consumers must be idempotent. Cloudflare account currently reports R2 is not enabled; until enabled, snapshot uploads remain unavailable. S3 compatibility does not automatically imply lifecycle rules, so verify bucket retention explicitly after provisioning.
