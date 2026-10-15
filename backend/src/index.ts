import { createRemoteJWKSet, jwtVerify } from "jose";
import * as Sentry from "@sentry/cloudflare";
import postgres from "postgres";
import { canEdit, canRead, normalizeTitle } from "./access";
import {
  softDeleteDocument,
  restoreDocument,
  hardDeleteDocument,
  emptyTrash,
  getDocument,
  listDocuments as listDocumentsLifecycle,
  duplicateDocument,
  listVersions,
  listComments,
  createComment,
  patchComment,
  deleteComment,
  LifecycleError,
} from "./lifecycle";
import type { DocumentEvent, Env } from "./document-room";
import { DocumentRoom } from "./document-room";
import { RateLimiter } from "./rate-limiter";

type Identity = { id: string; email: string | null; name: string };
type DocumentRow = { id: string; title: string; updated_at: string; workspace_name?: string; role?: string };

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
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)").bind(identity.id, identity.email, identity.name.slice(0, 120)).run();
  const workspaceId = "personal:" + identity.id;
  await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_by) VALUES (?, ?, ?)").bind(workspaceId, "Personal workspace", identity.id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role_id) VALUES (?, ?, 'role-owner')").bind(workspaceId, identity.id).run();
}

type CalendarEventInput = {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  link_url: string | null;
  email_to: string | null;
  reminder_minutes: number | null;
  document_id: string | null;
};

function parseCalendarEventInput(value: unknown): CalendarEventInput {
  if (!value || typeof value !== "object") throw new HttpError(400, "Event details are required");
  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title || title.length > 160) throw new HttpError(400, "Title must be between 1 and 160 characters");
  if (description.length > 4000) throw new HttpError(400, "Description is too long");

  const parseDate = (field: string): string => {
    const value = body[field];
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      throw new HttpError(400, field + " must be a valid date and time");
    }
    return new Date(value).toISOString();
  };
  const start_at = parseDate("start_at");
  const end_at = parseDate("end_at");
  if (Date.parse(end_at) <= Date.parse(start_at)) throw new HttpError(400, "End time must be after start time");

  const all_day = body.all_day === true || body.all_day === 1;
  let link_url: string | null = null;
  if (typeof body.link_url === "string" && body.link_url.trim()) {
    try {
      const parsed = new URL(body.link_url.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Unsupported protocol");
      link_url = parsed.toString();
    } catch {
      throw new HttpError(400, "Event links must use a valid http or https URL");
    }
  }

  let email_to: string | null = null;
  if (typeof body.email_to === "string" && body.email_to.trim()) {
    email_to = body.email_to.trim().toLowerCase();
    if (email_to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_to)) {
      throw new HttpError(400, "Enter a valid email address");
    }
  }

  let reminder_minutes: number | null = null;
  if (body.reminder_minutes !== null && body.reminder_minutes !== undefined && body.reminder_minutes !== "") {
    const reminder = Number(body.reminder_minutes);
    if (![0, 5, 10, 15, 30, 60, 1440].includes(reminder)) {
      throw new HttpError(400, "Unsupported reminder interval");
    }
    reminder_minutes = reminder;
  }

  const document_id = typeof body.document_id === "string" && body.document_id.trim()
    ? body.document_id.trim()
    : null;
  return { title, description, start_at, end_at, all_day, link_url, email_to, reminder_minutes, document_id };
}

async function roleForDocument(env: Env, documentId: string, userId: string): Promise<string | null> {
  const result = await env.DB.prepare(
    "SELECT COALESCE(document_role.name, workspace_role.name) AS role FROM documents d " +
    "LEFT JOIN workspace_members wm ON wm.workspace_id = d.workspace_id AND wm.user_id = ? " +
    "LEFT JOIN roles workspace_role ON workspace_role.id = wm.role_id " +
    "LEFT JOIN document_members dm ON dm.document_id = d.id AND dm.user_id = ? " +
    "LEFT JOIN roles document_role ON document_role.id = dm.role_id " +
    "WHERE d.id = ? AND (wm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)"
  ).bind(userId, userId, documentId).first<{ role: string }>();
  return result?.role ?? null;
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
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }});
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    return response(request, env, { ok: true, service: "collab-docs-api", version: env.APP_VERSION || "dev" });
  }
  if (parts[0] === "api" && parts[1] === "public" && parts[2] && request.method === "GET") {
    const token = parts[2];
    if (token.length < 16 || token.length > 128) throw new HttpError(404, "Not found");
    const doc = await env.DB.prepare("SELECT id, title, updated_at FROM documents WHERE public_token = ?").bind(token).first<{ id: string; title: string; updated_at: string }>();
    if (!doc) throw new HttpError(404, "Not found");
    const room = roomFor(env, doc.id);
    const snapshotUrl = new URL("https://do/__snapshot");
    snapshotUrl.searchParams.set("documentId", doc.id);
    const snap = await room.fetch(new Request(snapshotUrl.toString(), { method: "GET" }));
    const body = await snap.json().catch(() => ({ state: "" })) as { state?: string };
    return response(request, env, { document: { id: doc.id, title: doc.title, updated_at: doc.updated_at }, state: body.state || "", mode: "public-readonly" });
  }

  // Browser WebSocket handshakes cannot attach Authorization headers. Authenticate
  // the upgrade with the short-lived, single-use ticket created by POST /ticket.
  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "socket" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const documentId = parts[2];
    const ticketId = url.searchParams.get("ticket") || "";
    if (ticketId.length < 16 || ticketId.length > 128) throw new HttpError(401, "Collaboration ticket missing");
    const roomUrl = new URL("https://do/__socket");
    roomUrl.searchParams.set("documentId", documentId);
    roomUrl.searchParams.set("ticket", ticketId);
    const forwarded = new Request(roomUrl.toString(), request);
    forwarded.headers.set("x-ticket-id", ticketId);
    return roomFor(env, documentId).fetch(forwarded);
  }

  const identity = await authenticate(request, env);
  await ensureIdentity(env, identity);

  if (parts.length === 3 && parts[1] === "calendar" && parts[2] === "events" && request.method === "GET") {
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const fromValue = fromRaw && Number.isFinite(Date.parse(fromRaw))
      ? new Date(fromRaw).toISOString()
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const toValue = toRaw && Number.isFinite(Date.parse(toRaw))
      ? new Date(toRaw).toISOString()
      : new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString();
    if (Date.parse(toValue) <= Date.parse(fromValue)) throw new HttpError(400, "Calendar range is invalid");
    const result = await env.DB.prepare(
      "SELECT id, title, description, start_at, end_at, all_day, link_url, email_to, reminder_minutes, document_id, created_at, updated_at " +
      "FROM calendar_events WHERE user_id = ? AND start_at < ? AND end_at >= ? ORDER BY start_at ASC LIMIT 250"
    ).bind(identity.id, toValue, fromValue).all();
    return response(request, env, { events: result.results });
  }

  if (parts.length === 3 && parts[1] === "calendar" && parts[2] === "events" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const input = parseCalendarEventInput(body);
    if (input.document_id) {
      const role = await roleForDocument(env, input.document_id, identity.id);
      if (!role || !canRead(role)) throw new HttpError(403, "You do not have access to the attached document");
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO calendar_events (id, user_id, title, description, start_at, end_at, all_day, link_url, email_to, reminder_minutes, document_id) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, identity.id, input.title, input.description, input.start_at, input.end_at,
      input.all_day ? 1 : 0, input.link_url, input.email_to, input.reminder_minutes, input.document_id
    ).run();
    const created = await env.DB.prepare(
      "SELECT id, title, description, start_at, end_at, all_day, link_url, email_to, reminder_minutes, document_id, created_at, updated_at " +
      "FROM calendar_events WHERE id = ? AND user_id = ?"
    ).bind(id, identity.id).first();
    return response(request, env, { event: created }, 201);
  }

  if (parts.length === 4 && parts[1] === "calendar" && parts[2] === "events" && parts[3]) {
    const eventId = parts[3];
    if (request.method === "PATCH") {
      const existing = await env.DB.prepare("SELECT id FROM calendar_events WHERE id = ? AND user_id = ?")
        .bind(eventId, identity.id).first<{ id: string }>();
      if (!existing) throw new HttpError(404, "Calendar event not found");
      const body = await request.json().catch(() => null);
      const input = parseCalendarEventInput(body);
      if (input.document_id) {
        const role = await roleForDocument(env, input.document_id, identity.id);
        if (!role || !canRead(role)) throw new HttpError(403, "You do not have access to the attached document");
      }
      await env.DB.prepare(
        "UPDATE calendar_events SET title = ?, description = ?, start_at = ?, end_at = ?, all_day = ?, link_url = ?, email_to = ?, reminder_minutes = ?, document_id = ?, updated_at = CURRENT_TIMESTAMP " +
        "WHERE id = ? AND user_id = ?"
      ).bind(
        input.title, input.description, input.start_at, input.end_at, input.all_day ? 1 : 0,
        input.link_url, input.email_to, input.reminder_minutes, input.document_id, eventId, identity.id
      ).run();
      const updated = await env.DB.prepare(
        "SELECT id, title, description, start_at, end_at, all_day, link_url, email_to, reminder_minutes, document_id, created_at, updated_at " +
        "FROM calendar_events WHERE id = ? AND user_id = ?"
      ).bind(eventId, identity.id).first();
      return response(request, env, { event: updated });
    }
    if (request.method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM calendar_events WHERE id = ? AND user_id = ?").bind(eventId, identity.id).run();
      if (!result.meta.changes) throw new HttpError(404, "Calendar event not found");
      return response(request, env, { ok: true });
    }
  }

  if (parts.length === 2 && parts[1] === "documents" && request.method === "GET") {
    const search = url.searchParams.get("search") || undefined;
    const sort = url.searchParams.get("sort") || undefined;
    const filter = url.searchParams.get("filter") || undefined;
    return response(request, env, { documents: await listDocumentsLifecycle(env, identity.id, { search, sort, filter }) });
  }

  if (parts.length === 3 && parts[1] === "documents" && parts[2] === "trash" && request.method === "GET") {
    return response(request, env, { documents: await listDocumentsLifecycle(env, identity.id, { trash: true }) });
  }

  if (parts.length === 3 && parts[1] === "documents" && parts[2] === "trash" && request.method === "DELETE") {
    return response(request, env, await emptyTrash(env, identity.id));
  }

  if (parts.length === 2 && parts[1] === "documents" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = normalizeTitle(body.title) || "Untitled document";
    const documentId = crypto.randomUUID();
    const workspaceId = "personal:" + identity.id;
    await env.DB.prepare("INSERT INTO documents (id, workspace_id, title, created_by) VALUES (?, ?, ?, ?)").bind(documentId, workspaceId, title, identity.id).run();
    await env.DB.prepare("INSERT INTO document_members (document_id, user_id, role_id) VALUES (?, ?, 'role-owner')").bind(documentId, identity.id).run();
    return response(request, env, { document: { id: documentId, title, updated_at: new Date().toISOString(), role: "owner" } }, 201);
  }

  if (parts.length === 3 && parts[1] === "documents" && parts[2] && request.method === "GET") {
    const doc = await getDocument(env, parts[2], identity.id);
    if (!doc) throw new HttpError(404, "Document not found");
    return response(request, env, { document: doc });
  }

  if (parts.length === 3 && parts[1] === "documents" && parts[2] && request.method === "PATCH") {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || !canEdit(role)) throw new HttpError(403, "Forbidden");
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = normalizeTitle(body.title);
    if (!title) throw new HttpError(400, "title is required");
    await env.DB.prepare("UPDATE documents SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(title, documentId).run();
    return response(request, env, { document: { id: documentId, title } });
  }

  if (parts.length === 3 && parts[1] === "documents" && parts[2] && request.method === "DELETE") {
    const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    if (operationKey.length > 200) throw new HttpError(400, "Idempotency-Key is too long");
    await softDeleteDocument(env, parts[2], identity.id, operationKey);
    return response(request, env, { ok: true });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "restore" && request.method === "POST") {
    const doc = await restoreDocument(env, parts[2], identity.id);
    if (!doc) throw new HttpError(404, "Document not found");
    return response(request, env, { document: doc });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "hard" && request.method === "DELETE") {
    const operationKey = request.headers.get("Idempotency-Key") || crypto.randomUUID();
    await hardDeleteDocument(env, parts[2], identity.id, operationKey);
    return response(request, env, { ok: true });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "duplicate" && request.method === "POST") {
    const doc = await duplicateDocument(env, parts[2], identity.id);
    return response(request, env, { document: doc }, 201);
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "versions" && request.method === "GET") {
    return response(request, env, { versions: await listVersions(env, parts[2], identity.id) });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "comments" && request.method === "GET") {
    return response(request, env, { comments: await listComments(env, parts[2], identity.id) });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "comments" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { body?: string; threadId?: string; anchor?: unknown };
    if (typeof body.body !== "string") throw new HttpError(400, "body is required");
    const comment = await createComment(env, parts[2], identity.id, body.body, typeof body.threadId === "string" ? body.threadId : undefined, body.anchor);
    return response(request, env, { comment }, 201);
  }

  if (parts.length === 3 && parts[1] === "comments" && parts[2] && request.method === "PATCH") {
    const body = await request.json().catch(() => ({})) as { body?: string; resolved?: boolean };
    return response(request, env, { comment: await patchComment(env, parts[2], identity.id, body) });
  }

  if (parts.length === 3 && parts[1] === "comments" && parts[2] && request.method === "DELETE") {
    await deleteComment(env, parts[2], identity.id);
    return response(request, env, { ok: true });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "ticket" && request.method === "POST") {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || !canRead(role)) throw new HttpError(403, "Forbidden");
    const ticketId = crypto.randomUUID();
    const expiresAt = Date.now() + 60_000;
    const issueUrl = new URL("https://do/__issue_ticket");
    issueUrl.searchParams.set("documentId", documentId);
    const issue = await roomFor(env, documentId).fetch(new Request(issueUrl.toString(), {
      method: "POST",
      headers: {
        "x-ticket-id": ticketId,
        "x-user-id": identity.id,
        "x-user-role": role,
        "x-ticket-expiry": String(expiresAt)
      }
    }));
    if (!issue.ok) throw new HttpError(500, "Could not issue collaboration ticket (" + issue.status + ")");
    return response(request, env, { ticket: ticketId, expiresIn: 60 });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "public-link" && (request.method === "POST" || request.method === "DELETE")) {
    const documentId = parts[2];
    const role = await roleForDocument(env, documentId, identity.id);
    if (!role || role !== "owner") throw new HttpError(403, "Only owners can manage public links");
    if (request.method === "DELETE") {
      await env.DB.prepare("UPDATE documents SET public_token = NULL WHERE id = ?").bind(documentId).run();
      return response(request, env, { ok: true, publicUrl: null });
    }
    const existing = await env.DB.prepare("SELECT public_token FROM documents WHERE id = ?").bind(documentId).first<{ public_token: string | null }>();
    let token = existing?.public_token || null;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await env.DB.prepare("UPDATE documents SET public_token = ? WHERE id = ?").bind(token, documentId).run();
    }
    const origin = env.FRONTEND_ORIGIN || "";
    return response(request, env, {
      token,
      publicUrl: origin ? origin.replace(/\/$/, "") + "/p/?token=" + token : "/p/?token=" + token
    });
  }

  if (parts.length === 4 && parts[1] === "documents" && parts[2] && parts[3] === "members") {
    const documentId = parts[2];
    const callerRole = await roleForDocument(env, documentId, identity.id);
    if (request.method === "GET") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can list members");
      const result = await env.DB.prepare(
        "SELECT u.email, r.name AS role FROM document_members dm JOIN users u ON u.id = dm.user_id JOIN roles r ON r.id = dm.role_id WHERE dm.document_id = ?"
      ).bind(documentId).all();
      return response(request, env, { members: result.results });
    }
    if (request.method === "POST") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can share");
      const body = await request.json().catch(() => ({})) as { email?: string; role?: string };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const memberRole = body.role === "viewer" ? "viewer" : "editor";
      if (!email || !email.includes("@")) throw new HttpError(400, "Valid email is required");
      const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
      if (!user) throw new HttpError(404, "User not found. They must sign in once first.");
      const roleId = memberRole === "viewer" ? "role-viewer" : "role-editor";
      await env.DB.prepare("INSERT OR REPLACE INTO document_members (document_id, user_id, role_id) VALUES (?, ?, ?)").bind(documentId, user.id, roleId).run();
      return response(request, env, { member: { email, role: memberRole } }, 201);
    }
    if (request.method === "DELETE") {
      if (callerRole !== "owner") throw new HttpError(403, "Only document owners can remove members");
      const email = url.searchParams.get("email") || "";
      const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.trim().toLowerCase()).first<{ id: string }>();
      if (user) await env.DB.prepare("DELETE FROM document_members WHERE document_id = ? AND user_id = ?").bind(documentId, user.id).run();
      return response(request, env, { ok: true });
    }
  }

  return response(request, env, { error: "Not found" }, 404);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = Date.now();
    try {
      const result = await route(request, env);
      console.log(JSON.stringify({ event: "http.request", status: result.status, method: request.method, path: new URL(request.url).pathname, duration_ms: Date.now() - startedAt }));
      return result;
    } catch (error) {
      const status = error instanceof HttpError || error instanceof LifecycleError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Internal error";
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
        await env.DB.prepare("INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)").bind(event.eventId, event.userId, event.documentId, event.type, event.occurredAt, JSON.stringify({ updateNumber: event.updateNumber })).run();
        await env.DB.prepare("UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(event.documentId).run();
        if (env.HYPERDRIVE?.connectionString) {
          const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false });
          try {
            await sql.begin(async (tx) => {
              const inserted = await tx.unsafe("INSERT INTO user_activity (event_id, user_id, document_id, action, occurred_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id", [event.eventId, event.userId, event.documentId, event.type, event.occurredAt]);
              if (inserted.length > 0) {
                await tx.unsafe("INSERT INTO document_stats (document_id, update_count, last_updated_at) VALUES ($1, 1, $2) ON CONFLICT (document_id) DO UPDATE SET update_count = document_stats.update_count + 1, last_updated_at = EXCLUDED.last_updated_at", [event.documentId, event.occurredAt]);
              }
            });
          } finally {
            await sql.end({ timeout: 1 });
          }
        }
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "queue.consume_failed", eventId: event.eventId, message: error instanceof Error ? error.message : String(error) }));
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
