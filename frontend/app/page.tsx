"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearAccessToken, completeOidcLogin, getAccessToken, startOidcLogin } from "@/lib/auth";
import { CollabEditor } from "@/components/collab-editor";
import { formatDistanceToNow } from "date-fns";
import { Toaster, toast } from "sonner";
import { CommandPalette, type CommandItem } from "@/components/command-palette";

type DocumentItem = {
  id: string;
  title: string;
  updated_at: string;
  workspace_name?: string;
  role?: string;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const TEMPLATES: Array<{ id: string; title: string }> = [
  { id: "blank", title: "Untitled document" },
  { id: "meeting", title: "Meeting notes" },
  { id: "brief", title: "Project brief" },
  { id: "spec", title: "Tech spec" },
];

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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [publicLink, setPublicLink] = useState("");
  const [publicBusy, setPublicBusy] = useState(false);
  const [viewMode, setViewMode] = useState<"docs" | "trash">("docs");
  const [filter, setFilter] = useState<"all" | "mine" | "shared">("all");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const contextRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingDocId = useRef<string | null>(null);
  const pendingRestore = useRef<{ id: string; title: string } | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("doc");
    if (fromUrl) pendingDocId.current = fromUrl;
    try {
      const fav = JSON.parse(localStorage.getItem("collab-favorites") || "[]");
      if (Array.isArray(fav)) setFavorites(fav.filter((x) => typeof x === "string"));
    } catch { /* ignore */ }
    const stored = localStorage.getItem("collab-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("collab-favorites", JSON.stringify(next));
      return next;
    });
  }

  async function ensurePublicLink() {
    if (!active) return;
    setPublicBusy(true);
    try {
      const result = await request<{ publicUrl: string; token: string }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/public-link",
        { method: "POST" }
      );
      const url = result.publicUrl.startsWith("http") ? result.publicUrl : window.location.origin + result.publicUrl;
      setPublicLink(url);
      await navigator.clipboard.writeText(url);
      toast.success("Public view link copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create public link");
    } finally {
      setPublicBusy(false);
    }
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("collab-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  const refresh = useCallback(async (mode?: "docs" | "trash") => {
    const nextMode = mode || viewMode;
    try {
      const path = nextMode === "trash" ? "/api/documents/trash" : "/api/documents?filter=" + encodeURIComponent(filter);
      const result = await request<{ documents: DocumentItem[] }>(path);
      setDocuments(result.documents);
      if (nextMode === "docs") {
        const targetId = pendingDocId.current || new URLSearchParams(window.location.search).get("doc");
        if (targetId) {
          const found = result.documents.find((d) => d.id === targetId);
          if (found) {
            pendingDocId.current = targetId;
            setActive(found);
          } else {
            try {
              const one = await request<{ document: DocumentItem }>("/api/documents/" + encodeURIComponent(targetId));
              if (one.document) {
                pendingDocId.current = targetId;
                setActive(one.document);
              }
            } catch { /* no access */ }
          }
        }
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [viewMode, filter]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("code") && !url.searchParams.has("state") && !url.searchParams.has("error")) void refresh();
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
        const hasToken = Boolean(await getAccessToken());
        setSignedIn(hasToken);
        await refresh();
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
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setDeleteTarget(null);
        setShareOpen(false);
        setCmdOpen(false);
        setTemplateOpen(false);
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
    if (sortBy === "name") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else list = [...list].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return list;
  }, [documents, search, sortBy]);

  useEffect(() => {
    const targetId = pendingDocId.current || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("doc") : null);
    if (!targetId || documents.length === 0 || viewMode === "trash") return;
    const found = documents.find((d) => d.id === targetId);
    if (found && active?.id !== found.id) {
      pendingDocId.current = targetId;
      setActive(found);
    }
  }, [documents, active?.id, viewMode]);

  async function signIn() {
    try { await startOidcLogin(); } catch (err) { setError(err instanceof Error ? err.message : "Could not start sign-in"); }
  }

  async function signOut() {
    pendingDocId.current = null;
    setSignedIn(false); setActive(null); setDocuments([]); setError("");
    window.history.replaceState({}, "", window.location.pathname);
    await clearAccessToken();
  }

  async function shareDocument() {
    if (!active) return;
    setSharing(true); setShareMessage("");
    try {
      const result = await request<{ member: { email: string; role: string } }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/members",
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }) }
      );
      setShareMessage("Access granted to " + result.member.email + " as " + result.member.role + ".");
      setInviteEmail("");
      toast.success("Shared with " + result.member.email);
    } catch (err) {
      setShareMessage(err instanceof Error ? err.message : "Could not share document");
    } finally { setSharing(false); }
  }

  async function copyDocumentLink() {
    if (!active) return;
    try {
      const link = new URL("/", window.location.origin);
      link.searchParams.set("doc", active.id);
      await navigator.clipboard.writeText(link.toString());
      setShareMessage("App link copied.");
      toast.success("Link copied");
    } catch { setShareMessage("Copy failed."); }
  }

  async function duplicateDocument(doc: DocumentItem) {
    try {
      const result = await request<{ document: DocumentItem }>(
        "/api/documents/" + encodeURIComponent(doc.id) + "/duplicate",
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      setViewMode("docs");
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document);
      setContextMenu(null);
      toast.success("Document duplicated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not duplicate");
    }
  }

  async function restoreDocument(doc: DocumentItem) {
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id) + "/restore", { method: "POST" });
      toast.success("Document restored");
      setViewMode("docs");
      await refresh("docs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore");
    }
  }

  async function hardDeleteDocument(doc: DocumentItem) {
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id) + "/hard", {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      toast.success("Permanently deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete forever");
    }
  }

  async function createFromTemplate(title: string) {
    setCreating(true);
    setTemplateOpen(false);
    try {
      const result = await request<{ document: DocumentItem }>("/api/documents", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title }),
      });
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document);
      toast.success("Created from template");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setCreating(false);
    }
  }

  async function createDocument() {
    setCreating(true);
    try {
      const result = await request<{ document: DocumentItem }>("/api/documents", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: "Untitled document" }),
      });
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document); setError(""); setSidebarOpen(false);
      toast.success("Document created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document");
      toast.error("Failed to create document");
    } finally { setCreating(false); }
  }

  async function deleteDocument(doc: DocumentItem) {
    setDeleting(true);
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id), { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } });
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      if (active?.id === doc.id) {
        pendingDocId.current = null;
        setActive(null);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setDeleteTarget(null); setDeleteConfirm("");
      pendingRestore.current = { id: doc.id, title: doc.title };
      toast.success("Moved to trash", {
        description: "Undo within 8 seconds",
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            const target = pendingRestore.current;
            if (!target) return;
            void request("/api/documents/" + encodeURIComponent(target.id) + "/restore", { method: "POST" })
              .then(() => { toast.success("Restored"); void refresh("docs"); })
              .catch(() => toast.error("Could not undo"));
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete document");
    } finally { setDeleting(false); }
  }

  async function renameDocument(doc: DocumentItem, title: string) {
    const next = title.trim().slice(0, 120) || "Untitled document";
    setRenamingId(null);
    if (next === doc.title) return;
    setDocuments((list) => list.map((d) => (d.id === doc.id ? { ...d, title: next } : d)));
    if (active?.id === doc.id) setActive((a) => (a ? { ...a, title: next } : a));
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id), {
        method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: next }),
      });
      toast.success("Renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
      void refresh();
    }
  }

  function openContextMenu(e: React.MouseEvent, doc: DocumentItem) {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  }

  function startRename(doc: DocumentItem) {
    setContextMenu(null); setRenamingId(doc.id); setRenameValue(doc.title);
  }

  const isFirstRunEmpty = !loading && viewMode === "docs" && filter === "all" && !search.trim() && documents.length === 0;

  const commandItems: CommandItem[] = [
    { id: "new", label: "New document", hint: "Create blank", run: () => void createDocument() },
    { id: "template", label: "New from template…", run: () => setTemplateOpen(true) },
    { id: "home", label: "Go to home", run: () => { pendingDocId.current = null; setActive(null); } },
    { id: "trash", label: "Open trash", run: () => { setViewMode("trash"); setActive(null); void refresh("trash"); } },
    { id: "theme", label: "Toggle theme", run: () => toggleTheme() },
    ...documents.slice(0, 12).map((d) => ({
      id: "doc-" + d.id,
      label: d.title,
      hint: "Open",
      run: () => { pendingDocId.current = d.id; setActive(d); setViewMode("docs"); },
    })),
  ];

  return (
    <main className="shell">
      <Toaster position="bottom-right" richColors closeButton />
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden />}
      <aside className={"sidebar" + (sidebarOpen ? " sidebar-open" : "")}>
        <a className="brand" href="/" aria-label="Collab Docs home" onClick={() => { pendingDocId.current = null; setActive(null); }}>
          <span className="brand-mark">C</span><span>collab<span className="brand-light">docs</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="workspace-pill"><span className="workspace-dot" /> Personal workspace</div>
        <div className="search-wrap"><input className="search-input" type="search" placeholder="Search documents…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search documents" /></div>
        <div className="sort-row">
          <button type="button" className={sortBy === "updated" ? "sort-btn active" : "sort-btn"} onClick={() => setSortBy("updated")}>Recent</button>
          <button type="button" className={sortBy === "name" ? "sort-btn active" : "sort-btn"} onClick={() => setSortBy("name")}>Name</button>
        </div>
        <div className="sort-row filter-row">
          <button type="button" className={filter === "all" && viewMode === "docs" ? "sort-btn active" : "sort-btn"} onClick={() => { setFilter("all"); setViewMode("docs"); void refresh("docs"); }}>All</button>
          <button type="button" className={filter === "mine" && viewMode === "docs" ? "sort-btn active" : "sort-btn"} onClick={() => { setFilter("mine"); setViewMode("docs"); void refresh("docs"); }}>Mine</button>
          <button type="button" className={filter === "shared" && viewMode === "docs" ? "sort-btn active" : "sort-btn"} onClick={() => { setFilter("shared"); setViewMode("docs"); void refresh("docs"); }}>Shared</button>
          <button type="button" className={viewMode === "trash" ? "sort-btn active" : "sort-btn"} onClick={() => { setViewMode("trash"); setActive(null); void refresh("trash"); }}>Trash</button>
        </div>
        <div className="sidebar-label docs-label">{viewMode === "trash" ? "TRASH" : "YOUR DOCUMENTS"}</div>
        <button className="new-doc" onClick={createDocument} disabled={creating || viewMode === "trash"}><span>＋</span> New document</button>
        <button type="button" className="sort-btn" style={{ width: "100%", textAlign: "left" }} onClick={() => setTemplateOpen(true)} disabled={creating || viewMode === "trash"}>Templates…</button>
        <div className="document-list" role="list">
          {loading && (<><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></>)}
          {!loading && filtered.map((doc) => (
            <div key={doc.id} className={"document-item" + (active?.id === doc.id ? " selected" : "")} role="listitem">
              {renamingId === doc.id ? (
                <input ref={renameInputRef} className="inline-rename" value={renameValue} maxLength={120} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => void renameDocument(doc, renameValue)} onKeyDown={(e) => { if (e.key === "Enter") void renameDocument(doc, renameValue); if (e.key === "Escape") setRenamingId(null); }} aria-label="Rename document" />
              ) : (
                <button type="button" className="document-link" onClick={() => { pendingDocId.current = doc.id; setActive(doc); setSidebarOpen(false); }} onDoubleClick={() => startRename(doc)} onContextMenu={(e) => openContextMenu(e, doc)}>
                  <span className="doc-symbol" aria-hidden>▤</span>
                  <span className="doc-meta"><span className="doc-title">{doc.title}</span><span className="doc-date">{relativeTime(doc.updated_at)}</span></span>
                  {doc.role === "viewer" && <span className="role-badge">View</span>}
                </button>
              )}
              <button type="button" className="fav-star" aria-label="Toggle favorite" onClick={(e) => { e.stopPropagation(); toggleFavorite(doc.id); }}>{favorites.includes(doc.id) ? "★" : "☆"}</button>
              <button type="button" className="doc-more" aria-label="Document actions" onClick={(e) => openContextMenu(e, doc)}>···</button>
            </div>
          ))}
          {!loading && filtered.length === 0 && search && <div className="list-placeholder">No documents match “{search}”</div>}
          {!loading && documents.length === 0 && (
            <div className="list-placeholder">
              {viewMode === "trash" ? "Trash is empty." : filter === "mine" ? "No owned documents." : filter === "shared" ? "Nothing shared with you." : "No documents yet."}
            </div>
          )}
        </div>
        <div className="sidebar-bottom"><span className="avatar">B</span><div><strong>{signedIn ? "Signed-in account" : "Local workspace"}</strong><small>{signedIn ? "Authenticated session" : "Development session"}</small></div></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="menu-toggle" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
            <div className="breadcrumbs"><span>Personal workspace</span><span className="slash">/</span><strong>{active?.title || (viewMode === "trash" ? "Trash" : "Home")}</strong></div>
          </div>
          <div className="top-actions">
            <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">{theme === "dark" ? "☀" : "☾"}</button>
            <span className="secure-label"><span className="green-dot" /> Autosave enabled</span>
            <button className="share-button" onClick={() => { setShareMessage(""); setPublicLink(""); setShareOpen(true); }} disabled={!active || active.role !== "owner"}>↗ Share</button>
            {process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL && (signedIn ? <button className="auth-button" onClick={signOut}>Sign out</button> : <button className="auth-button" onClick={signIn}>Sign in</button>)}
            <span className="avatar small-avatar">B</span>
          </div>
        </header>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {active ? (
          <CollabEditor key={active.id} documentId={active.id} initialTitle={active.title} apiBase={API} readOnly={active.role === "viewer"} onTitleChange={(title) => setDocuments((list) => list.map((d) => (d.id === active.id ? { ...d, title } : d)))} onDeleteRequest={() => setDeleteTarget(active)} />
        ) : loading ? (
          <div className="dashboard"><div className="skeleton-row" style={{ maxWidth: 320, margin: "48px auto" }} /><div className="skeleton-row" style={{ maxWidth: 480, margin: "12px auto" }} /></div>
        ) : viewMode === "trash" && (documents.length === 0 || filtered.length === 0) ? (
          <div className="empty-state compact-empty"><div className="eyebrow">TRASH</div><h1>{documents.length === 0 ? "Trash is empty" : "No matches"}</h1><p>{documents.length === 0 ? "Deleted documents will appear here." : "No trashed documents match your search."}</p></div>
        ) : viewMode === "trash" ? (
          <div className="empty-state compact-empty"><div className="eyebrow">TRASH</div><h1>{filtered.length} in trash</h1><p>Open a document from the sidebar, or use ··· to restore or delete forever.</p></div>
        ) : isFirstRunEmpty ? (
          <div className="workspace-home">
            <div className="workspace-hero">
              <div className="workspace-intro">
                <div className="eyebrow">Your workspace</div>
                <h1 className="workspace-title">Good ideas are better <em>together.</em></h1>
                <p className="workspace-lead">Create a document and invite others in. Changes sync live, and your work stays available offline.</p>
                <div className="workspace-actions">
                  <button className="primary-button workspace-cta" onClick={createDocument} disabled={creating}>{creating ? "Creating…" : "Create document →"}</button>
                  <button type="button" className="secondary-button" onClick={() => setTemplateOpen(true)} disabled={creating}>Browse templates</button>
                </div>
                <div className="feature-row">
                  <span className="feature-item">Real-time collaboration</span>
                  <span className="feature-item">Offline-ready</span>
                  <span className="feature-item">Built to keep up</span>
                </div>
              </div>
              <div className="editor-preview" aria-hidden="true">
                <div className="preview-chrome">
                  <div className="preview-dots"><span /><span /><span /></div>
                  <div className="preview-toolbar"><span /><span /><span className="wide" /><span /><span /></div>
                </div>
                <div className="preview-paper">
                  <div className="preview-title-line" />
                  <div className="preview-line long" />
                  <div className="preview-line" />
                  <div className="preview-line mid" />
                  <div className="preview-line" />
                  <div className="preview-line short" />
                  <div className="preview-line mid" />
                </div>
              </div>
            </div>
            <section className="quick-start">
              <div className="quick-start-header">
                <h2>Start writing</h2>
                <p>Pick a blank page or a structured template.</p>
              </div>
              <div className="template-grid quick-start-grid">
                {TEMPLATES.map((tpl) => (
                  <button key={tpl.id} type="button" className="template-card" onClick={() => void createFromTemplate(tpl.title)} disabled={creating}>
                    <span className="template-icon" aria-hidden>{tpl.id === "blank" ? "◇" : tpl.id === "meeting" ? "☰" : tpl.id === "brief" ? "▣" : "⚙"}</span>
                    <span className="template-body">
                      <span className="template-title">{tpl.title}</span>
                      <span className="template-desc">{tpl.id === "blank" ? "Start with a clean page" : tpl.id === "meeting" ? "Agenda, notes, and actions" : tpl.id === "brief" ? "Goals, scope, and milestones" : "Requirements and decisions"}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : documents.length === 0 || filtered.length === 0 ? (
          <div className="empty-state compact-empty">
            <div className="eyebrow">{filter === "mine" ? "OWNED BY YOU" : filter === "shared" ? "SHARED WITH YOU" : "DOCUMENTS"}</div>
            <h1>{search.trim() ? "No matches" : "No documents"}</h1>
            <p>{search.trim() ? "No documents match “" + search.trim() + "”." : filter === "mine" ? "You don’t own any documents yet." : filter === "shared" ? "Nothing has been shared with you yet." : "No documents to show."}</p>
          </div>
        ) : (
          <div className="dashboard">
            <div className="eyebrow">Workspace</div>
            <h1 className="dashboard-title">Welcome back</h1>
            <p className="dashboard-sub">Your documents at a glance. Press ⌘K for commands.</p>
            <div className="stat-row">
              <div className="stat-card"><strong>{documents.length}</strong><span>Documents</span></div>
              <div className="stat-card"><strong>{documents.filter((d) => d.role && d.role !== "owner").length}</strong><span>Shared with you</span></div>
              <div className="stat-card"><strong>{favorites.filter((id) => documents.some((d) => d.id === id)).length}</strong><span>Favorites</span></div>
              <div className="stat-card"><strong>{documents.filter((d) => d.role === "owner").length}</strong><span>Owned by you</span></div>
            </div>
            <div className="dash-section">
              <h2>Recent</h2>
              <div className="dash-grid">
                {filtered.slice(0, 8).map((doc) => (
                  <button key={doc.id} type="button" className="dash-card" onClick={() => { pendingDocId.current = doc.id; setActive(doc); }}>
                    <span className="t">{doc.title}</span>
                    <span className="m">{relativeTime(doc.updated_at)} · {doc.role || "member"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {shareOpen && active && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShareOpen(false); }}>
            <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <div className="modal-heading"><div><div className="eyebrow">COLLABORATION</div><h2 id="share-title">Share document</h2></div><button className="modal-close" onClick={() => setShareOpen(false)} aria-label="Close">×</button></div>
              <p className="modal-copy">Invite a teammate, or create a public view link without an account.</p>
              {publicLink && <p className="share-feedback">Public: {publicLink}</p>}
              <form className="share-form" onSubmit={(e) => { e.preventDefault(); void shareDocument(); }}>
                <label htmlFor="invite-email">Email address</label>
                <input id="invite-email" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" />
                <label htmlFor="invite-role">Permission</label>
                <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}><option value="editor">Can edit</option><option value="viewer">Can view</option></select>
                <div className="share-feedback" role="status">{shareMessage}</div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyDocumentLink()}>Copy app link</button>
                  <button type="button" className="secondary-button" onClick={() => void ensurePublicLink()} disabled={publicBusy}>{publicBusy ? "Creating…" : "Public view link"}</button>
                  <button type="button" className="secondary-button" onClick={() => setShareOpen(false)}>Close</button>
                  <button type="submit" className="primary-button" disabled={sharing}>{sharing ? "Sharing…" : "Grant access"}</button>
                </div>
              </form>
            </section>
          </div>
        )}
        {deleteTarget && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setDeleteTarget(null); setDeleteConfirm(""); } }}>
            <section className="share-modal danger-modal" role="dialog" aria-modal="true">
              <div className="modal-heading"><div><div className="eyebrow danger-eyebrow">DESTRUCTIVE</div><h2>Delete document?</h2></div><button className="modal-close" onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }} aria-label="Close">×</button></div>
              <p className="modal-copy"><strong>{deleteTarget.title}</strong> will be moved to Trash.</p>
              <label htmlFor="delete-confirm">Type delete to confirm</label>
              <input id="delete-confirm" className="delete-confirm-input" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="delete" autoComplete="off" />
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }}>Cancel</button>
                <button type="button" className="danger-button" disabled={deleteConfirm !== "delete" || deleting} onClick={() => void deleteDocument(deleteTarget)}>{deleting ? "Deleting…" : "Move to trash"}</button>
              </div>
            </section>
          </div>
        )}
        {contextMenu && (
          <div ref={contextRef} className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} role="menu">
            <button type="button" role="menuitem" onClick={() => { pendingDocId.current = contextMenu.doc.id; setActive(contextMenu.doc); setContextMenu(null); setSidebarOpen(false); }}>Open</button>
            <button type="button" role="menuitem" onClick={() => startRename(contextMenu.doc)}>Rename</button>
            <button type="button" role="menuitem" onClick={() => void duplicateDocument(contextMenu.doc)} disabled={viewMode === "trash"}>Duplicate</button>
            <button type="button" role="menuitem" onClick={() => { setActive(contextMenu.doc); setShareOpen(true); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner" || viewMode === "trash"}>Share…</button>
            {viewMode === "trash" ? (
              <>
                <button type="button" role="menuitem" onClick={() => void restoreDocument(contextMenu.doc)}>Restore</button>
                <div className="context-divider" />
                <button type="button" role="menuitem" className="danger-item" onClick={() => { void hardDeleteDocument(contextMenu.doc); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner"}>Delete forever…</button>
              </>
            ) : (
              <>
                <div className="context-divider" />
                <button type="button" role="menuitem" className="danger-item" onClick={() => { setDeleteTarget(contextMenu.doc); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner"}>Move to trash…</button>
              </>
            )}
          </div>
        )}
      </section>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commandItems} />
      {templateOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setTemplateOpen(false); }}>
          <section className="share-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div><div className="eyebrow">TEMPLATES</div><h2>Start from a template</h2></div>
              <button className="modal-close" onClick={() => setTemplateOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="template-grid">
              {TEMPLATES.map((tpl) => (
                <button key={tpl.id} type="button" className="dash-card" onClick={() => void createFromTemplate(tpl.title)} disabled={creating}>
                  <span className="t">{tpl.title}</span>
                  <span className="m">{tpl.id === "blank" ? "Empty document" : "Prefilled title"}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
