import * as Y from "yjs";
import { canEdit } from "./access";

export type DocumentEvent = {
  eventId: string;
  type: "document.updated";
  documentId: string;
  userId: string;
  updateNumber: number;
  occurredAt: string;
};

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  SNAPSHOTS: R2Bucket;
  DOCUMENT_EVENTS: Queue<DocumentEvent>;
  DOC_ROOMS: DurableObjectNamespace;
  ENVIRONMENT: string;
  AUTH_MODE?: string;
  AUTH_JWKS_URL?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  FRONTEND_ORIGIN?: string;
  APP_VERSION?: string;
  HYPERDRIVE?: { connectionString: string };
}

type RoomAttachment = { userId: string; role: string; documentId: string };

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function toBase64(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 1) binary += String.fromCharCode(value[i]);
  return btoa(binary);
}
function asBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export class DocumentRoom {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS doc_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, update_blob BLOB NOT NULL, created_at INTEGER NOT NULL);"
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS doc_snapshots (id INTEGER PRIMARY KEY CHECK (id = 1), state BLOB NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL);"
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS issued_tickets (ticket_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);"
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const docId = url.searchParams.get("documentId") || "";
    if (url.pathname === "/__issue_ticket" && request.method === "POST") {
      const ticketId = request.headers.get("x-ticket-id");
      const userId = request.headers.get("x-user-id");
      const role = request.headers.get("x-user-role");
      const expiresAt = Number(request.headers.get("x-ticket-expiry") || 0);
      if (!ticketId || !userId || !role || !docId || expiresAt <= Date.now()) {
        return new Response("Invalid ticket request", { status: 400 });
      }
      try {
        this.ctx.storage.sql.exec(
          "INSERT INTO issued_tickets (ticket_id, document_id, user_id, role, expires_at, consumed) VALUES (?, ?, ?, ?, ?, 0)",
          ticketId, docId, userId, role, expiresAt
        );
      } catch {
        return new Response("Ticket already exists", { status: 409 });
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const ticketId = request.headers.get("x-ticket-id");
    const userId = request.headers.get("x-user-id");
    const role = request.headers.get("x-user-role");
    if (!ticketId || !userId || !role || !docId) return new Response("Unauthorized", { status: 401 });

    let authorized = false;
    this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec(
        "SELECT ticket_id FROM issued_tickets WHERE ticket_id = ? AND document_id = ? AND user_id = ? AND role = ? AND consumed = 0 AND expires_at > ?",
        ticketId, docId, userId, role, Date.now()
      ).toArray();
      if (rows.length === 1) {
        this.ctx.storage.sql.exec("UPDATE issued_tickets SET consumed = 1 WHERE ticket_id = ?", ticketId);
        authorized = true;
      }
    });
    if (!authorized) return new Response("Expired or already used ticket", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, role, documentId: docId } satisfies RoomAttachment);
    console.log(JSON.stringify({ event: "ws.connected", documentId: docId, role }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let message: { type?: string; update?: string; state?: string };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_json" }));
      return;
    }

    const attachment = socket.deserializeAttachment() as RoomAttachment | null;
    if (!attachment) {
      socket.close(1008, "Missing connection identity");
      return;
    }

    if (message.type === "sync") {
      if (message.state && canEdit(attachment.role)) {
        await this.applyAndPersist(socket, attachment, message.state);
      }
      const document = await this.loadDocument();
      socket.send(JSON.stringify({ type: "sync", state: toBase64(Y.encodeStateAsUpdate(document)) }));
      document.destroy();
      return;
    }

    if (message.type === "update") {
      if (!canEdit(attachment.role)) {
        socket.send(JSON.stringify({ type: "error", error: "read_only" }));
        return;
      }
      if (message.update) await this.applyAndPersist(socket, attachment, message.update);
    }
  }

  webSocketClose(socket: WebSocket): void {
    try { socket.close(); } catch { /* already closed */ }
  }

  webSocketError(_socket: WebSocket, error: unknown): void {
    console.error(JSON.stringify({ event: "ws.error", message: String(error) }));
  }

  private async loadDocument(): Promise<Y.Doc> {
    const document = new Y.Doc();
    const snapshots = this.ctx.storage.sql.exec(
      "SELECT state FROM doc_snapshots WHERE id = 1"
    ).toArray() as Array<{ state: ArrayBuffer | ArrayBufferView }>;
    if (snapshots[0]) Y.applyUpdate(document, asBytes(snapshots[0].state));
    const updates = this.ctx.storage.sql.exec(
      "SELECT update_blob FROM doc_updates ORDER BY id ASC"
    ).toArray() as Array<{ update_blob: ArrayBuffer | ArrayBufferView }>;
    for (const row of updates) Y.applyUpdate(document, asBytes(row.update_blob));
    return document;
  }

  private async applyAndPersist(socket: WebSocket, attachment: RoomAttachment, encoded: string): Promise<void> {
    let update: Uint8Array;
    try { update = fromBase64(encoded); } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_update" }));
      return;
    }
    const document = await this.loadDocument();
    try {
      Y.applyUpdate(document, update);
      const inserted = this.ctx.storage.sql.exec(
        "INSERT INTO doc_updates (update_blob, created_at) VALUES (?, ?) RETURNING id",
        update, Date.now()
      ).toArray() as Array<{ id: number }>;
      const updateNumber = Number(inserted[0]?.id || 0);
      const updateCount = this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM doc_updates").toArray() as Array<{ count: number }>;

      if (updateNumber > 0 && Number(updateCount[0]?.count || 0) >= 100) {
        const snapshot = Y.encodeStateAsUpdate(document);
        this.ctx.storage.sql.exec(
          "INSERT INTO doc_snapshots (id, state, version, created_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, version = excluded.version, created_at = excluded.created_at",
          snapshot, updateNumber, Date.now()
        );
        this.ctx.storage.sql.exec("DELETE FROM doc_updates WHERE id <= ?", updateNumber);
        try {
          await this.env.SNAPSHOTS.put(attachment.documentId + "/" + String(updateNumber) + ".bin", snapshot, {
            httpMetadata: { contentType: "application/octet-stream" },
            customMetadata: { documentId: attachment.documentId, version: String(updateNumber) }
          });
        } catch (error) {
          console.error(JSON.stringify({ event: "snapshot.write_failed", documentId: attachment.documentId, message: String(error) }));
        }
      }

      const event: DocumentEvent = {
        eventId: attachment.documentId + ":" + String(updateNumber),
        type: "document.updated",
        documentId: attachment.documentId,
        userId: attachment.userId,
        updateNumber,
        occurredAt: new Date().toISOString()
      };
      await this.env.DOCUMENT_EVENTS.send(event);
      const broadcast = JSON.stringify({ type: "update", update: encoded });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === socket) continue;
        try { peer.send(broadcast); } catch { /* a peer may be closing */ }
      }
      console.log(JSON.stringify({ event: "crdt.update", documentId: attachment.documentId, updateNumber, bytes: update.byteLength }));
    } catch (error) {
      console.error(JSON.stringify({ event: "crdt.persist_failed", documentId: attachment.documentId, message: String(error) }));
      socket.send(JSON.stringify({ type: "error", error: "persist_failed" }));
    } finally {
      document.destroy();
    }
  }
}
