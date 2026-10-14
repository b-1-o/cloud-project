import type { Env } from "./document-room";
import { canEdit, canRead, normalizeTitle } from "./access";

export type DocumentRow = {
  id: string;
  title: string;
  updated_at: string;
  created_at?: string;
  workspace_name?: string;
  role?: string;
  deleted_at?: string | null;
  archived_at?: string | null;
  last_content_preview?: string | null;
  word_count?: number;
};

export class LifecycleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function roleForDocument(
  env: Env,
  documentId: string,
  userId: string
): Promise<string | null> {
  const result = await env.DB.prepare(
    "SELECT COALESCE(document_role.name, workspace_role.name) AS role FROM documents d " +
      "LEFT JOIN workspace_members wm ON wm.workspace_id = d.workspace_id AND wm.user_id = ? " +
      "LEFT JOIN roles workspace_role ON workspace_role.id = wm.role_id " +
      "LEFT JOIN document_members dm ON dm.document_id = d.id AND dm.user_id = ? " +
      "LEFT JOIN roles document_role ON document_role.id = dm.role_id " +
      "WHERE d.id = ? AND (wm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)"
  )
    .bind(userId, userId, documentId)
    .first<{ role: string }>();
  return result?.role ?? null;
}

export async function listDocuments(
  env: Env,
  userId: string,
  options?: { search?: string; sort?: string; filter?: string; trash?: boolean }
): Promise<DocumentRow[]> {
  const search = (options?.search || "").trim().slice(0, 120);
  const sort = options?.sort || "updated";
  const filter = options?.filter || "all";
  const trash = Boolean(options?.trash);

  let order = "d.updated_at DESC";
  if (sort === "name") order = "d.title COLLATE NOCASE ASC";
  else if (sort === "created") order = "d.created_at DESC";

  const clauses: string[] = ["(wm.user_id IS NOT NULL OR dm.user_id IS NOT NULL)"];
  const binds: string[] = [userId, userId];

  if (trash) {
    clauses.push("d.deleted_at IS NOT NULL");
  } else {
    clauses.push("d.deleted_at IS NULL");
  }

  if (filter === "mine") {
    clauses.push("COALESCE(document_role.name, workspace_role.name) = 'owner'");
  } else if (filter === "shared") {
    clauses.push("COALESCE(document_role.name, workspace_role.name) != 'owner'");
  } else if (filter === "archived") {
    clauses.push("d.archived_at IS NOT NULL");
  }

  if (search) {
    clauses.push("(d.title LIKE ? OR IFNULL(d.last_content_preview, '') LIKE ?)");
    const like = "%" + search.replace(/%/g, "\\%").replace(/_/g, "\\_") + "%";
    binds.push(like, like);
  }

  const sql =
    "SELECT DISTINCT d.id, d.title, d.updated_at, d.created_at, w.name AS workspace_name, " +
    "COALESCE(document_role.name, workspace_role.name) AS role, d.deleted_at, d.archived_at, " +
    "d.last_content_preview, d.word_count " +
    "FROM documents d JOIN workspaces w ON w.id = d.workspace_id " +
    "LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ? " +
    "LEFT JOIN roles workspace_role ON workspace_role.id = wm.role_id " +
    "LEFT JOIN document_members dm ON dm.document_id = d.id AND dm.user_id = ? " +
    "LEFT JOIN roles document_role ON document_role.id = dm.role_id " +
    "WHERE " +
    clauses.join(" AND ") +
    " ORDER BY " +
    order +
    " LIMIT 100";

  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all<DocumentRow>();
  return result.results;
}

export async function getDocument(
  env: Env,
  documentId: string,
  userId: string
): Promise<DocumentRow | null> {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || !canRead(role)) return null;
  const row = await env.DB.prepare(
    "SELECT d.id, d.title, d.updated_at, d.created_at, w.name AS workspace_name, " +
      "d.deleted_at, d.archived_at, d.last_content_preview, d.word_count " +
      "FROM documents d JOIN workspaces w ON w.id = d.workspace_id WHERE d.id = ?"
  )
    .bind(documentId)
    .first<DocumentRow>();
  if (!row) return null;
  return { ...row, role };
}

export async function softDeleteDocument(
  env: Env,
  documentId: string,
  userId: string,
  operationKey: string
): Promise<void> {
  const role = await roleForDocument(env, documentId, userId);
  if (!role) return;
  if (role !== "owner") throw new LifecycleError(403, "Only document owners can delete documents");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
  )
    .bind("document.soft_deleted:" + documentId + ":" + operationKey, userId, documentId, "document.soft_deleted", "{}")
    .run();
  await env.DB.prepare(
    "UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL"
  )
    .bind(documentId)
    .run();
}

export async function restoreDocument(
  env: Env,
  documentId: string,
  userId: string
): Promise<DocumentRow | null> {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || role !== "owner") throw new LifecycleError(403, "Only owners can restore documents");
  await env.DB.prepare(
    "UPDATE documents SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(documentId)
    .run();
  await env.DB.prepare(
    "INSERT INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
  )
    .bind("document.restored:" + documentId + ":" + crypto.randomUUID(), userId, documentId, "document.restored", "{}")
    .run();
  return getDocument(env, documentId, userId);
}

export async function hardDeleteDocument(
  env: Env,
  documentId: string,
  userId: string,
  operationKey: string
): Promise<void> {
  const role = await roleForDocument(env, documentId, userId);
  if (!role) return;
  if (role !== "owner") throw new LifecycleError(403, "Only document owners can permanently delete documents");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO audit_log (event_id, user_id, document_id, action, payload_json) VALUES (?, ?, ?, ?, ?)"
  )
    .bind("document.hard_deleted:" + documentId + ":" + operationKey, userId, documentId, "document.hard_deleted", "{}")
    .run();
  await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(documentId).run();
}

export async function emptyTrash(env: Env, userId: string): Promise<{ deleted: number }> {
  const trash = await listDocuments(env, userId, { trash: true });
  let deleted = 0;
  for (const doc of trash) {
    if (doc.role !== "owner") continue;
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(doc.id).run();
    deleted += 1;
  }
  return { deleted };
}

export async function duplicateDocument(
  env: Env,
  documentId: string,
  userId: string
): Promise<DocumentRow> {
  const source = await getDocument(env, documentId, userId);
  if (!source) throw new LifecycleError(404, "Document not found");
  if (!source.role || !canRead(source.role)) throw new LifecycleError(403, "Forbidden");

  const meta = await env.DB.prepare(
    "SELECT workspace_id, title FROM documents WHERE id = ?"
  )
    .bind(documentId)
    .first<{ workspace_id: string; title: string }>();
  if (!meta) throw new LifecycleError(404, "Document not found");

  const newId = crypto.randomUUID();
  const title = normalizeTitle(meta.title + " (copy)") || "Untitled document";
  await env.DB.prepare(
    "INSERT INTO documents (id, workspace_id, title, created_by) VALUES (?, ?, ?, ?)"
  )
    .bind(newId, meta.workspace_id, title, userId)
    .run();
  await env.DB.prepare(
    "INSERT INTO document_members (document_id, user_id, role_id) VALUES (?, ?, 'role-owner')"
  )
    .bind(newId, userId)
    .run();

  return {
    id: newId,
    title,
    updated_at: new Date().toISOString(),
    workspace_name: source.workspace_name,
    role: "owner",
  };
}

export async function listVersions(env: Env, documentId: string, userId: string) {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || !canRead(role)) throw new LifecycleError(403, "Forbidden");
  const result = await env.DB.prepare(
    "SELECT id, document_id, created_at, created_by, label FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(documentId)
    .all<{ id: string; document_id: string; created_at: string; created_by: string | null; label: string | null }>();
  return result.results;
}

export async function createVersion(
  env: Env,
  documentId: string,
  userId: string,
  snapshot: ArrayBuffer | Uint8Array,
  label?: string
) {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || !canEdit(role)) throw new LifecycleError(403, "Forbidden");
  const id = crypto.randomUUID();
  const bytes = snapshot instanceof Uint8Array ? snapshot : new Uint8Array(snapshot);
  await env.DB.prepare(
    "INSERT INTO document_versions (id, document_id, snapshot, created_by, label) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, documentId, bytes, userId, label || null)
    .run();

  await env.DB.prepare(
    "DELETE FROM document_versions WHERE document_id = ? AND id NOT IN (" +
      "SELECT id FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 50)"
  )
    .bind(documentId, documentId)
    .run();

  return { id, document_id: documentId, created_by: userId, label: label || null };
}

export async function listComments(env: Env, documentId: string, userId: string) {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || !canRead(role)) throw new LifecycleError(403, "Forbidden");
  const result = await env.DB.prepare(
    "SELECT c.id, c.document_id, c.author_id, c.thread_id, c.body, c.resolved, c.created_at, c.updated_at, c.anchor_json, u.display_name AS author_name " +
      "FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.document_id = ? ORDER BY c.created_at ASC LIMIT 500"
  )
    .bind(documentId)
    .all();
  return result.results;
}

export async function createComment(
  env: Env,
  documentId: string,
  userId: string,
  body: string,
  threadId?: string,
  anchor?: unknown
) {
  const role = await roleForDocument(env, documentId, userId);
  if (!role || !canRead(role)) throw new LifecycleError(403, "Forbidden");
  const text = body.trim().slice(0, 4000);
  if (!text) throw new LifecycleError(400, "Comment body is required");
  const id = crypto.randomUUID();
  const thread = threadId || id;
  await env.DB.prepare(
    "INSERT INTO comments (id, document_id, author_id, thread_id, body, anchor_json) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, documentId, userId, thread, text, JSON.stringify(anchor || {}))
    .run();
  return {
    id,
    document_id: documentId,
    author_id: userId,
    thread_id: thread,
    body: text,
    resolved: 0,
    anchor_json: JSON.stringify(anchor || {}),
  };
}

export async function patchComment(
  env: Env,
  commentId: string,
  userId: string,
  patch: { body?: string; resolved?: boolean }
) {
  const row = await env.DB.prepare(
    "SELECT id, document_id, author_id, body, resolved FROM comments WHERE id = ?"
  )
    .bind(commentId)
    .first<{ id: string; document_id: string; author_id: string; body: string; resolved: number }>();
  if (!row) throw new LifecycleError(404, "Comment not found");
  const role = await roleForDocument(env, row.document_id, userId);
  if (!role) throw new LifecycleError(403, "Forbidden");
  if (patch.body !== undefined && row.author_id !== userId && role !== "owner") {
    throw new LifecycleError(403, "Only the author can edit this comment");
  }
  const nextBody = patch.body !== undefined ? patch.body.trim().slice(0, 4000) : row.body;
  const nextResolved =
    patch.resolved !== undefined ? (patch.resolved ? 1 : 0) : row.resolved;
  if (patch.body !== undefined && !nextBody) throw new LifecycleError(400, "Comment body is required");
  await env.DB.prepare(
    "UPDATE comments SET body = ?, resolved = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(nextBody, nextResolved, commentId)
    .run();
  return { id: commentId, body: nextBody, resolved: nextResolved };
}

export async function deleteComment(env: Env, commentId: string, userId: string) {
  const row = await env.DB.prepare(
    "SELECT id, document_id, author_id FROM comments WHERE id = ?"
  )
    .bind(commentId)
    .first<{ id: string; document_id: string; author_id: string }>();
  if (!row) return;
  const role = await roleForDocument(env, row.document_id, userId);
  if (!role) throw new LifecycleError(403, "Forbidden");
  if (row.author_id !== userId && role !== "owner") {
    throw new LifecycleError(403, "Only the author or owner can delete this comment");
  }
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();
}

export function exportPlain(title: string, format: string, text: string): { contentType: string; body: string; filename: string } {
  const safe = (title || "document").replace(/[^\w\s-]/g, "").trim() || "document";
  if (format === "html") {
    const escaped = text
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">");
    const html =
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>" +
      title.replace(/</g, "") +
      "</title></head><body><h1>" +
      title.replace(/</g, "") +
      "</h1><pre style=\"white-space:pre-wrap;font-family:Georgia,serif\">" +
      escaped +
      "</pre></body></html>";
    return { contentType: "text/html; charset=utf-8", body: html, filename: safe + ".html" };
  }
  if (format === "json") {
    return {
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ title, text }, null, 2),
      filename: safe + ".json",
    };
  }
  return {
    contentType: "text/markdown; charset=utf-8",
    body: "# " + title + "\n\n" + text,
    filename: safe + ".md",
  };
}
