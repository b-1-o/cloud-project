"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearAccessToken, completeOidcLogin, getAccessToken, startOidcLogin } from "@/lib/auth";
import { CollabEditor } from "@/components/collab-editor";
import { formatDistanceToNow } from "date-fns";
import { Toaster, toast } from "sonner";

type DocumentItem = {
  id: string;
  title: string;
  updated_at: string;
  workspace_name?: string;
  role?: string;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  const token = await getAccessToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API + path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Request failed (" + response.status + ")");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export default function HomePage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [active, setActive] = useState<DocumentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"updated" | "name">("updated");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: DocumentItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const contextRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await request<{ documents: DocumentItem[] }>("/api/documents");
      setDocuments(result.documents);
      const sharedId = new URLSearchParams(window.location.search).get("doc");
      if (sharedId) {
        const found = result.documents.find((d) => d.id === sharedId) || null;
        setActive(found);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("code") && !url.searchParams.has("state") && !url.searchParams.has("error")) {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    async function finishSignIn() {
      try {
        const completed = await completeOidcLogin(new URL(window.location.href));
        if (completed) {
          setSignedIn(true);
          setError("");
          await refresh();
          return;
        }
        setSignedIn(Boolean(await getAccessToken()));
      } catch (err) {
        setSignedIn(false);
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    }
    void finishSignIn();
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href);
    url.searchParams.set("doc", active.id);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, [active]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setContextMenu(null);
        setDeleteTarget(null);
        setShareOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = documents;
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q));
    if (sortBy === "name") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list = [...list].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    return list;
  }, [documents, search, sortBy]);

  async function signIn() {
    try {
      await startOidcLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in");
    }
  }

  async function signOut() {
    setSignedIn(false);
    setActive(null);
    setDocuments([]);
    setError("");
    window.history.replaceState({}, "", window.location.pathname);
    await clearAccessToken();
  }

  async function shareDocument() {
    if (!active) return;
    setSharing(true);
    setShareMessage("");
    try {
      const result = await request<{ member: { email: string; role: string } }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/members",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        }
      );
      setShareMessage("Access granted to " + result.member.email + " as " + result.member.role + ".");
      setInviteEmail("");
      toast.success("Shared with " + result.member.email);
    } catch (err) {
      setShareMessage(err instanceof Error ? err.message : "Could not share document");
    } finally {
      setSharing(false);
    }
  }

  async function copyDocumentLink() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(window.location.origin + "/?doc=" + encodeURIComponent(active.id));
      setShareMessage("Link copied. The recipient must sign in and have access.");
      toast.success("Link copied");
    } catch {
      setShareMessage("Copy failed. Copy the URL from the address bar.");
    }
  }

  async function createDocument() {
    setCreating(true);
    try {
      const result = await request<{ document: DocumentItem }>("/api/documents", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title: "Untitled document" }),
      });
      setDocuments((current) => [result.document, ...current]);
      setActive(result.document);
      setError("");
      setSidebarOpen(false);
      toast.success("Document created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document");
      toast.error("Failed to create document");
    } finally {
      setCreating(false);
    }
  }

  async function deleteDocument(doc: DocumentItem) {
    setDeleting(true);
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id), {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      if (active?.id === doc.id) {
        setActive(null);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setDeleteTarget(null);
      setDeleteConfirm("");
      toast.success("Document deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete document");
    } finally {
      setDeleting(false);
    }
  }

  async function renameDocument(doc: DocumentItem, title: string) {
    const next = title.trim().slice(0, 120) || "Untitled document";
    setRenamingId(null);
    if (next === doc.title) return;
    setDocuments((list) => list.map((d) => (d.id === doc.id ? { ...d, title: next } : d)));
    if (active?.id === doc.id) setActive((a) => (a ? { ...a, title: next } : a));
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id), {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title: next }),
      });
      toast.success("Renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
      void refresh();
    }
  }

  function openContextMenu(e: React.MouseEvent, doc: DocumentItem) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  }

  function startRename(doc: DocumentItem) {
    setContextMenu(null);
    setRenamingId(doc.id);
    setRenameValue(doc.title);
  }

  return (
    <main className="shell">
      <Toaster position="bottom-right" richColors closeButton />
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden />}
      <aside className={"sidebar" + (sidebarOpen ? " sidebar-open" : "")}>
        <a className="brand" href="/" aria-label="Collab Docs home">
          <span className="brand-mark">C</span>
          <span>
            collab<span className="brand-light">docs</span>
          </span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="workspace-pill">
          <span className="workspace-dot" /> Personal workspace
        </div>

        <div className="search-wrap">
          <input
            className="search-input"
            type="search"
            placeholder="Search documents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search documents"
          />
        </div>

        <div className="sort-row">
          <button
            type="button"
            className={sortBy === "updated" ? "sort-btn active" : "sort-btn"}
            onClick={() => setSortBy("updated")}
          >
            Recent
          </button>
          <button
            type="button"
            className={sortBy === "name" ? "sort-btn active" : "sort-btn"}
            onClick={() => setSortBy("name")}
          >
            Name
          </button>
        </div>

        <div className="sidebar-label docs-label">
          YOUR DOCUMENTS
          <button className="icon-button" aria-label="Create document" onClick={createDocument} disabled={creating}>
            ＋
          </button>
        </div>
        <button className="new-doc" onClick={createDocument} disabled={creating}>
          <span>＋</span> New document
        </button>

        <div className="document-list" role="list">
          {loading && (
            <>
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </>
          )}
          {!loading &&
            filtered.map((doc) => (
              <div
                key={doc.id}
                className={"document-item" + (active?.id === doc.id ? " selected" : "")}
                role="listitem"
              >
                {renamingId === doc.id ? (
                  <input
                    ref={renameInputRef}
                    className="inline-rename"
                    value={renameValue}
                    maxLength={120}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void renameDocument(doc, renameValue)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameDocument(doc, renameValue);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    aria-label="Rename document"
                  />
                ) : (
                  <button
                    type="button"
                    className="document-link"
                    onClick={() => {
                      setActive(doc);
                      setSidebarOpen(false);
                    }}
                    onDoubleClick={() => startRename(doc)}
                    onContextMenu={(e) => openContextMenu(e, doc)}
                  >
                    <span className="doc-symbol" aria-hidden>
                      ▤
                    </span>
                    <span className="doc-meta">
                      <span className="doc-title">{doc.title}</span>
                      <span className="doc-date">{relativeTime(doc.updated_at)}</span>
                    </span>
                    {doc.role === "viewer" && <span className="role-badge">View</span>}
                  </button>
                )}
                <button
                  type="button"
                  className="doc-more"
                  aria-label="Document actions"
                  onClick={(e) => openContextMenu(e, doc)}
                >
                  ···
                </button>
              </div>
            ))}
          {!loading && filtered.length === 0 && search && (
            <div className="list-placeholder">No documents match “{search}”</div>
          )}
          {!loading && documents.length === 0 && (
            <div className="list-placeholder">Your next great idea starts here.</div>
          )}
        </div>

        <div className="sidebar-bottom">
          <span className="avatar">B</span>
          <div>
            <strong>{signedIn ? "Signed-in account" : "Local workspace"}</strong>
            <small>{signedIn ? "Authenticated session" : "Development session"}</small>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-toggle"
              aria-label="Toggle sidebar"
              onClick={() => setSidebarOpen((o) => !o)}
            >
              ☰
            </button>
            <div className="breadcrumbs">
              <span>Personal workspace</span>
              <span className="slash">/</span>
              <strong>{active?.title || "Documents"}</strong>
            </div>
          </div>
          <div className="top-actions">
            <span className="secure-label">
              <span className="green-dot" /> Autosave enabled
            </span>
            <button
              className="share-button"
              onClick={() => {
                setShareMessage("");
                setShareOpen(true);
              }}
              disabled={!active || active.role !== "owner"}
            >
              ↗ Share
            </button>
            {process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL &&
              (signedIn ? (
                <button className="auth-button" onClick={signOut}>
                  Sign out
                </button>
              ) : (
                <button className="auth-button" onClick={signIn}>
                  Sign in
                </button>
              ))}
            <span className="avatar small-avatar">B</span>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {active ? (
          <CollabEditor
            key={active.id}
            documentId={active.id}
            initialTitle={active.title}
            apiBase={API}
            readOnly={active.role === "viewer"}
            onTitleChange={(title) =>
              setDocuments((list) => list.map((d) => (d.id === active.id ? { ...d, title } : d)))
            }
            onDeleteRequest={() => setDeleteTarget(active)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-art">
              <div className="art-sheet">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="art-bubble bubble-one">A</div>
              <div className="art-bubble bubble-two">B</div>
              <div className="art-cursor">✦</div>
            </div>
            <div className="eyebrow">A LITTLE MORE IN SYNC</div>
            <h1>
              Good ideas are better <em>together.</em>
            </h1>
            <p>Create a document and invite your thoughts in. Changes sync live, and your work stays available offline.</p>
            <button className="primary-button" onClick={createDocument} disabled={creating}>
              {creating ? "Creating…" : "Create your first document"} <span>→</span>
            </button>
            <div className="feature-row">
              <span>✳ Real-time collaboration</span>
              <span>◉ Offline-ready</span>
              <span>⌁ Built to keep up</span>
            </div>
          </div>
        )}

        {shareOpen && active && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShareOpen(false);
            }}
          >
            <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <div className="modal-heading">
                <div>
                  <div className="eyebrow">COLLABORATION</div>
                  <h2 id="share-title">Share document</h2>
                </div>
                <button className="modal-close" onClick={() => setShareOpen(false)} aria-label="Close">
                  ×
                </button>
              </div>
              <p className="modal-copy">
                Add a person who has already signed in. Their role controls whether they can edit or only read.
              </p>
              <form
                className="share-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void shareDocument();
                }}
              >
                <label htmlFor="invite-email">Email address</label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
                <label htmlFor="invite-role">Permission</label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <div className="share-feedback" role="status">
                  {shareMessage}
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyDocumentLink()}>
                    Copy link
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setShareOpen(false)}>
                    Close
                  </button>
                  <button type="submit" className="primary-button" disabled={sharing}>
                    {sharing ? "Sharing…" : "Grant access"} <span>→</span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {deleteTarget && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setDeleteTarget(null);
                setDeleteConfirm("");
              }
            }}
          >
            <section className="share-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
              <div className="modal-heading">
                <div>
                  <div className="eyebrow danger-eyebrow">DESTRUCTIVE</div>
                  <h2 id="delete-title">Delete document?</h2>
                </div>
                <button
                  className="modal-close"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="modal-copy">
                <strong>{deleteTarget.title}</strong> will be permanently deleted. This cannot be undone.
              </p>
              <label htmlFor="delete-confirm">Type DELETE to confirm</label>
              <input
                id="delete-confirm"
                className="delete-confirm-input"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={deleteConfirm !== "DELETE" || deleting}
                  onClick={() => void deleteDocument(deleteTarget)}
                >
                  {deleting ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            </section>
          </div>
        )}

        {contextMenu && (
          <div
            ref={contextRef}
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setActive(contextMenu.doc);
                setContextMenu(null);
                setSidebarOpen(false);
              }}
            >
              Open
            </button>
            <button type="button" role="menuitem" onClick={() => startRename(contextMenu.doc)}>
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setActive(contextMenu.doc);
                setShareOpen(true);
                setContextMenu(null);
              }}
              disabled={contextMenu.doc.role !== "owner"}
            >
              Share…
            </button>
            <div className="context-divider" />
            <button
              type="button"
              role="menuitem"
              className="danger-item"
              onClick={() => {
                setDeleteTarget(contextMenu.doc);
                setContextMenu(null);
              }}
              disabled={contextMenu.doc.role !== "owner"}
            >
              Delete…
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
