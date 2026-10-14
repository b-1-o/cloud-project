import { createRemoteJWKSet, jwtVerify } from "jose";
import * as Sentry from "@sentry/cloudflare";
import postgres from "postgres";
import { canEdit, canRead, normalizeTitle } from "./access";
import type { DocumentEvent, Env } from "./document-room";
import { DocumentRoom } from "./document-room";
import { RateLimiter } from "./rate-limiter";

type Identity = { id: string; email: string | null; name: string };

function isDocumentEvent(value: unknown): value is DocumentEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.type === "document.updated" &&
    typeof event.eventId === "string" &&
    typeof event.documentId === "string" &&
    typeof event.userId === "string" &&
    typeof event.updateNumber === "number" &&
    Number.isFinite(event.updateNumber) &&
    typeof event.occurredAt === "string";
}
type DocumentRow = { id: string; title: string; updated_at: string; workspace_name?: string; role?: string };
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function response(request: Request, env: Env, value: unknown, status = 200): Response {
  const origin = env.FRONTEND_ORIGIN || "*";
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
    "Vary": "Origin"
  });
  return new Response(JSON.stringify(value), { status, headers });
}

async function authenticate(request: Request, env: Env): Promise<Identity> {
  if (env.ENVIRONMENT !== "production" && env.AUTH_MODE === "demo") {
    return { id: "demo-user", email: "demo@localhost", name: "Local Demo" };
  }
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new HttpError(401, "Authentication required");
  if (!env.AUTH_JWKS_URL || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE) {
    throw new HttpError(503, "Identity provider is not configured");
  }
  try {
    let keySet = jwksCache.get(env.AUTH_JWKS_URL);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
      jwksCache.set(env.AUTH_JWKS_URL, keySet);
    }
    const verified = await jwtVerify(token, keySet, {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE
    });
    const sub = verified.payload.sub;
    if (!sub) throw new HttpError(401, "Token subject is missing");
    const email = typeof verified.payload.email === "string" ? verified.payload.email : null;
    const name = typeof verified.payload.name === "string" ? verified.payload.name : (email || sub);
    return { id: sub, email, name };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Invalid access token");
  }
}

async function ensureIdentity(env: Env, identity: Identity): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)"
  ).bind(identity.id, identity.email, identity.name.slice(0, 120)).run();
  const workspaceId = "personal:" + identity.id;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, created_by) VALUES (?, ?, ?)"
  ).bind(workspaceId, "Personal workspace", identity.id).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role_id) VALUES (?, ?, 'role-owner')"
  ).bind(workspaceId, identity.id).run();
}

async function roleForDocument(env: Env, documentId: string, userId: string): Promise<string | null> {
  const result = await env.DB.prepare(
    "SELECT COALESCE(document_role.name, workspace_role.name) AS role " +
    "FROM documents d " +
    "LEFT JOIN workspace_members wm ON wm.workspace_id = d.workspace_id AND wm.user_id = ? " +
    "LEFT JOIN roles workspace_role ON workspace_role.id = wm.role_id " +
    "LEFT JOIN document_members dm ON dm.document_id = d.id AND dm.user_id = ? " +
    "LEFT JOIN roles document_role ON document_role.id = dm.role_id " +
    "WHERE d.id = ? AND (wm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)"
  ).bind(userId, userId, documentId).first<{ role: string }>();
  return result?.role ?? null;
}

async function listDocuments(env: Env, userId: string): Promise<DocumentRow[]> {
  const result = await env.DB.prepare(
    "SELECT DISTINCT d.id, d.title, d.updated_at, w.name AS workspace_name, " +
    "COALESCE(document_role.name, workspace_role.name) AS role " +
    "FROM documents d JOIN workspaces w ON w.id = d.workspace_id " +
    "LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ? " +
    "LEFT JOIN roles workspace_role ON workspace_role.id = wm.role_id " +
    "LEFT JOIN document_members dm ON dm.document_id = d.id AND dm.user_id = ? " +
    "LEFT JOIN roles document_role ON document_role.id = dm.role_id " +
    "WHERE wm.user_id IS NOT NULL OR dm.user_id IS NOT NULL " +
    "ORDER BY d.updated_at DESC LIMIT 100"
  ).bind(userId, userId).all<DocumentRow>();
  return result.results;
}

function roomFor(env: Env, documentId: string) {
  return env.DOC_ROOMS.get(env.DOC_ROOMS.idFromName(documentId));
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": env.FRONTEND_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    } });
  }
  const requestOrigin = request.headers.get("Origin");
  if (env.ENVIRONMENT === "production" && requestOrigin && env.FRONTEND_ORIGIN && requestOrigin !== env.FRONTEND_ORIGIN) {
    throw new HttpError(403, "Origin not allowed");
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    return response(request, env, { ok: true, service: "collab-docs-api", version: env.APP_VERSION || "dev" });
  }

  if (parts[0] === "api" && parts[1] === "public" && parts[2] && request.method === "GET") {
    const token = parts[2];
    if (token.length < 16 || token.length > 80) throw new HttpError(400, "Invalid share token");
    const doc = await env.DB.prepare(
      "SELECT id, title, updated_at FROM documents WHERE public_token = ?"
    ).bind(token).first<{ id: string; title: string; updated_at: string }>();
    if (!doc) throw new HttpError(404, "Shared document not found");
    const snap = await roomFor(env, doc.id).fetch(
      "https://room.internal/__snapshot?documentId=" + encodeURIComponent(doc.id)
    );
    if (!snap.ok) throw new HttpError(503, "Could not load document content");
    const body = await snap.json() as { state?: string };
    return response(request, env, {
      document: { id: doc.id, title: doc.title, updated_at: doc.updated_at },
      state: body.state || "",
      mode: "public-readonly"
    });
  }

  if (parts[0] !== "api" || parts[1] !== "documents") {
    return response(request, env, { error: "Not found" }, 404);
  }

  if (parts.length === 4 && parts[2] && parts[3] === "socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const documentId = parts[2];
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new HttpError(401, "WebSocket ticket required");
    const raw = await env.SESSIONS.get("ticket:" + ticket);
    if (!raw) throw new HttpError(401, "Ticket expired or already used");
    const payload = JSON.parse(raw) as { documentId: string; userId: string; role: string; expiresAt: number };
    if (payload.documentId !== documentId || payload.expiresAt <= Date.now()) {
      await env.SESSIONS.delete("ticket:" + ticket);
      throw new HttpError(401, "Ticket is invalid");
    }
    await env.SESSIONS.delete("ticket:" + ticket);
    const forwarded = new Request(request, { headers: new Headers(request.headers) });
    forwarded.headers.set("x-ticket-id", ticket);
    forwarded.headers.set("x-user-id", payload.userId);
    forwarded.headers.set("x-user-role", payload.role);
    const roomUrl = new URL(forwarded.url);
    roomUrl.searchParams.set("documentId", documentId);
    const roomRequest = new Request(roomUrl.toString(), { method: "GET", headers: forwarded.headers });
    return roomFor(env, documentId).fetch(roomRequest);
  }

  const identity = await authenticate(request, env);
  await ensureIdentity(env, identity);

  if (parts.length === 2 && request.method === "GET") {
    return response(request, env, { documents: await listDocuments(env, identity.id) });
  }

  if (parts.length === 4 && parts[2] && parts[3] === "members") {
    const documentId = parts[2];
    const callerRole = await roleForDocument(env, documentId, identity.id);
    if (!callerRole) throw new HttpError(404, "Document not found");

    if (request.method === "GET") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can manage access");
      const members = await env.DB.prepare(
        "SELECT u.id AS user_id, u.email, u.display_name, r.name AS role, dm.created_at " +
        "FROM document_members dm JOIN users u ON u.id = dm.user_id JOIN roles r ON r.id = dm.role_id " +
        "WHERE dm.document_id = ? ORDER BY dm.created_at ASC"
      ).bind(documentId).all<{ user_id: string; email: string | null; display_name: string; role: string; created_at: string }>();
      return response(request, env, { members: members.results });
    }

    if (request.method === "POST") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can share access");
      const body = await request.json().catch(() => ({})) as { email?: unknown; role?: unknown };
      if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        throw new HttpError(400, "A valid member email is required");
      }
      const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : null;
      if (!role) throw new HttpError(400, "Role must be editor or viewer");
      const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
      if (operationKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
      const email = body.email.trim().toLowerCase();
      const member = await env.DB.prepare(
        "SELECT id, email, display_name FROM users WHERE lower(email) = ?"
      ).bind(email).first<{ id: string; email: string; display_name: string }>();
      if (!member) throw new HttpError(404, "That person must sign in once before you can share a document with them");
      if (member.id === identity.id) throw new HttpError(400, "You already own this document");
      await env.DB.prepare(
        "INSERT INTO document_members (document_id, user_id, role_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(document_id, user_id) DO UPDATE SET role_id = excluded.role_id"
      ).bind(documentId, member.id, "role-" + role).run();
      await env.DB.prepare(
        "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
      ).bind("document.member.shared:" + documentId + ":" + member.id + ":" + operationKey, identity.id, documentId, "document.member.shared", JSON.stringify({ email, role })).run();
      return response(request, env, { ok: true, member: { user_id: member.id, email: member.email, display_name: member.display_name, role } }, 200);
    }

    if (request.method === "DELETE") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can remove access");
      const memberId = url.searchParams.get("userId");
      if (!memberId || memberId === identity.id) throw new HttpError(400, "A different userId is required");
      const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
      if (operationKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
      await env.DB.prepare("DELETE FROM document_members WHERE document_id = ? AND user_id = ?")
        .bind(documentId, memberId).run();
      await env.DB.prepare(
        "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
      ).bind("document.member.removed:" + documentId + ":" + memberId + ":" + operationKey, identity.id, documentId, "document.member.removed", JSON.stringify({ userId: memberId })).run();
      return response(request, env, { ok: true });
    }
  }

  if (parts.length === 2 && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = normalizeTitle(body.title) || "Untitled document";
    const workspace = await env.DB.prepare(
      "SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1"
    ).bind(identity.id).first<{ workspace_id: string }>();
    if (!workspace) throw new HttpError(500, "User workspace could not be initialized");
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey && idempotencyKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
    let documentId = crypto.randomUUID();
    if (idempotencyKey) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.id + ":" + idempotencyKey));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      documentId = "idem_" + hex;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO documents (id, workspace_id, title, created_by) VALUES (?, ?, ?, ?)"
    ).bind(documentId, workspace.workspace_id, title, identity.id).run();
    const savedDocument = await env.DB.prepare(
      "SELECT id, title, updated_at FROM documents WHERE id = ? AND created_by = ?"
    ).bind(documentId, identity.id).first<{ id: string; title: string; updated_at: string }>();
    if (!savedDocument) throw new HttpError(500, "Document could not be created");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
    ).bind("document.created:" + documentId, identity.id, documentId, "document.created", JSON.stringify({ title: savedDocument.title })).run();
    return response(request, env, {
      document: { ...savedDocument, workspace_name: "Personal workspace", role: "owner" }
    }, 201);
  }

  if (parts.length === 4 && parts[2] && parts[3] === "ticket" && request.method === "POST") {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || !canRead(role)) throw new HttpError(404, "Document not found");
    const ticket = crypto.randomUUID();
    const expiresAt = Date.now() + 60_000;
    const payload = { documentId, userId: identity.id, role, expiresAt };
    await env.SESSIONS.put("ticket:" + ticket, JSON.stringify(payload), { expirationTtl: 60 });
    const issued = await roomFor(env, documentId).fetch(
      "https://room.internal/__issue_ticket?documentId=" + encodeURIComponent(documentId),
      { method: "POST", headers: {
        "x-ticket-id": ticket,
        "x-user-id": identity.id,
        "x-user-role": role,
        "x-ticket-expiry": String(expiresAt)
      } }
    );
    if (!issued.ok) {
      await env.SESSIONS.delete("ticket:" + ticket);
      throw new HttpError(503, "Could not issue collaboration ticket");
    }
    return response(request, env, { ticket, expiresIn: 60 });
  }

  if (parts.length === 4 && parts[2] && parts[3] === "public-link" && (request.method === "POST" || request.method === "DELETE")) {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || role !== "owner") throw new HttpError(403, "Only owners can manage public links");
    if (request.method === "DELETE") {
      await env.DB.prepare("UPDATE documents SET public_token = NULL WHERE id = ?").bind(documentId).run();
      return response(request, env, { ok: true, publicUrl: null });
    }
    const existing = await env.DB.prepare(
      "SELECT public_token FROM documents WHERE id = ?"
    ).bind(documentId).first<{ public_token: string | null }>();
    let token = existing?.public_token || null;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      await env.DB.prepare("UPDATE documents SET public_token = ? WHERE id = ?").bind(token, documentId).run();
    }
    const origin = env.FRONTEND_ORIGIN || "";
    return response(request, env, {
      ok: true,
      token,
      publicUrl: origin ? origin.replace(/\/$/, "") + "/p/" + token : "/p/" + token
    });
  }

  if (parts.length === 3 && parts[2] && request.method === "PATCH") {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || !canEdit(role)) throw new HttpError(404, "Document not found or read-only");
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = normalizeTitle(body.title);
    if (!title) throw new HttpError(400, "Title must contain 1-120 characters");
    const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    if (operationKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
    await env.DB.prepare("UPDATE documents SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(title, documentId).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
    ).bind("document.title.updated:" + documentId + ":" + operationKey, identity.id, documentId, "document.title.updated", JSON.stringify({ title })).run();
    return response(request, env, { ok: true, title });
  }

  if (parts.length === 3 && parts[2] && request.method === "DELETE") {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role) return response(request, env, { ok: true });
    if (role !== "owner") throw new HttpError(403, "Only document owners can delete documents");
    const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    if (operationKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
    ).bind("document.deleted:" + documentId + ":" + operationKey, identity.id, documentId, "document.deleted", JSON.stringify({})).run();
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(documentId).run();
    return response(request, env, { ok: true });
  }

  return response(request, env, { error: "Not found" }, 404);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startedAt = Date.now();
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health" && request.method !== "OPTIONS") {
        const ip = request.headers.get("cf-connecting-ip") || "local";
        const limiterId = env.RATE_LIMITERS.idFromName(ip);
        const limitResponse = await env.RATE_LIMITERS.get(limiterId).fetch(
          "https://rate-limiter.internal/check?key=" + encodeURIComponent(ip) + "&limit=120&windowMs=60000"
        );
        const limitResult = await limitResponse.json() as { allowed?: boolean; retryAfter?: number };
        if (!limitResponse.ok || limitResult.allowed !== true) {
          return new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "Retry-After": String(limitResult.retryAfter || 60),
              "Access-Control-Allow-Origin": env.FRONTEND_ORIGIN || "*",
              "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
              "Vary": "Origin"
            }
          });
        }
      }
      const result = await route(request, env);
      if (result.status !== 101) {
        console.log(JSON.stringify({ event: "http.request", method: request.method, path: new URL(request.url).pathname, status: result.status, duration_ms: Date.now() - startedAt }));
      }
      return result;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Unexpected error";
      console.error(JSON.stringify({ event: "http.error", status, method: request.method, path: new URL(request.url).pathname, duration_ms: Date.now() - startedAt, message }));
      return response(request, env, { error: status === 500 ? "Internal server error" : message }, status);
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const body: unknown = message.body;
      if (!isDocumentEvent(body)) {
        console.error(JSON.stringify({ event: "queue.invalid_message" }));
        message.retry();
        continue;
      }
      const event = body;
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          event.eventId,
          event.userId,
          event.documentId,
          event.type,
          event.occurredAt,
          JSON.stringify({ updateNumber: event.updateNumber })
        ).run();
        await env.DB.prepare(
          "UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(event.documentId).run();
        if (env.HYPERDRIVE?.connectionString) {
          const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false });
          try {
            await sql.begin(async (tx) => {
              const inserted = await tx.unsafe(
                "INSERT INTO user_activity (event_id, user_id, document_id, action, occurred_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
                [event.eventId, event.userId, event.documentId, event.type, event.occurredAt]
              );
              if (inserted.length > 0) {
                await tx.unsafe(
                  "INSERT INTO document_stats (document_id, update_count, last_updated_at) VALUES ($1, 1, $2) ON CONFLICT (document_id) DO UPDATE SET update_count = document_stats.update_count + 1, last_updated_at = EXCLUDED.last_updated_at",
                  [event.documentId, event.occurredAt]
                );
              }
            });
          } finally {
            await sql.end({ timeout: 1 });
          }
        }
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "queue.consume_failed",
          eventId: event.eventId,
          message: error instanceof Error ? error.message : String(error)
        }));
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry((env: Env) => ({
  dsn: env.SENTRY_DSN,
  environment: env.ENVIRONMENT,
  tracesSampleRate: env.ENVIRONMENT === "production" ? 0.1 : 1.0
}), worker);

export { DocumentRoom, RateLimiter };
