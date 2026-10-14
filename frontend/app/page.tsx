"use client";

import { useCallback, useEffect, useState } from "react";
import { CollabEditor } from "@/components/collab-editor";

type DocumentItem = { id: string; title: string; updated_at: string; workspace_name?: string; role?: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || ("Request failed (" + response.status + ")"));
  }
  return response.json() as Promise<T>;
}

export default function HomePage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [active, setActive] = useState<DocumentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await request<{ documents: DocumentItem[] }>("/api/documents");
      setDocuments(result.documents);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Collab Docs home"><span className="brand-mark">C</span><span>collab<span className="brand-light">docs</span></span></a>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="workspace-pill"><span className="workspace-dot" /> Personal workspace <span className="chevron">⌄</span></div>
        <div className="sidebar-row active-nav"><span>▤</span> Documents <span className="count">{documents.length}</span></div>
        <div className="sidebar-row muted-row"><span>◷</span> Recent</div>
        <div className="sidebar-label docs-label">YOUR DOCUMENTS <button className="icon-button" aria-label="Create document" onClick={createDocument}>＋</button></div>
        <button className="new-doc" onClick={createDocument} disabled={creating}><span>＋</span> New document</button>
        <div className="document-list">
          {loading ? <div className="list-placeholder">Loading documents…</div> : documents.map((doc) => (
            <button key={doc.id} className={"document-link" + (active?.id === doc.id ? " selected" : "")} onClick={() => setActive(doc)}>
              <span className="doc-symbol">▤</span><span className="doc-title">{doc.title}</span>
            </button>
          ))}
          {!loading && documents.length === 0 && <div className="list-placeholder">Your next great idea starts here.</div>}
        </div>
        <div className="sidebar-bottom"><span className="avatar">B</span><div><strong>Local workspace</strong><small>Development session</small></div><span className="more">···</span></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Personal workspace</span><span className="slash">/</span><strong>{active?.title || "Documents"}</strong></div>
          <div className="top-actions"><span className="secure-label"><span className="green-dot" /> Autosave enabled</span><button className="share-button" onClick={() => active && navigator.clipboard?.writeText(window.location.origin + "/?doc=" + active.id)} disabled={!active}>↗ Share link</button><span className="avatar small-avatar">B</span></div>
        </header>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {active ? <CollabEditor key={active.id} documentId={active.id} initialTitle={active.title} apiBase={API} onTitleChange={(title) => setDocuments((list) => list.map((d) => d.id === active.id ? { ...d, title } : d))} /> : (
          <div className="empty-state">
            <div className="empty-art"><div className="art-sheet"><span /><span /><span /><span /></div><div className="art-bubble bubble-one">A</div><div className="art-bubble bubble-two">B</div><div className="art-cursor">✦</div></div>
            <div className="eyebrow">A LITTLE MORE IN SYNC</div>
            <h1>Good ideas are better <em>together.</em></h1>
            <p>Create a document and invite your thoughts in. Changes sync live, and your work stays available offline.</p>
            <button className="primary-button" onClick={createDocument} disabled={creating}>{creating ? "Creating…" : "Create your first document"} <span>→</span></button>
            <div className="feature-row"><span>✳ Real-time collaboration</span><span>◉ Offline-ready</span><span>⌁ Built to keep up</span></div>
          </div>
        )}
      </section>
    </main>
  );
}
