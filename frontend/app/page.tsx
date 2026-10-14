"use client";

import { useCallback, useEffect, useState } from "react";
import { clearAccessToken, completeOidcLogin, getAccessToken, startOidcLogin } from "@/lib/auth";
import { CollabEditor } from "@/components/collab-editor";

type DocumentItem = { id: string; title: string; updated_at: string; workspace_name?: string; role?: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API + path, { ...init, headers });
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
  const [signedIn, setSignedIn] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await request<{ documents: DocumentItem[] }>("/api/documents");
      setDocuments(result.documents);
      const sharedId = new URLSearchParams(window.location.search).get("doc");
      if (sharedId) setActive(result.documents.find((document) => document.id === sharedId) || null);
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
    setSignedIn(Boolean(getAccessToken()));
    async function finishSignIn() {
      try {
        const completed = await completeOidcLogin(new URL(window.location.href));
        if (completed) {
          setSignedIn(true);
          setError("");
          await refresh();
        }
      } catch (err) {
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

  async function signIn() {
    try {
      await startOidcLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in");
    }
  }

  function signOut() {
    clearAccessToken();
    setSignedIn(false);
    setActive(null);
    setDocuments([]);
    setError("");
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function shareDocument() {
    if (!active) return;
    setSharing(true);
    setShareMessage("");
    try {
      const result = await request<{ member: { email: string; role: string } }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/members",
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }) }
      );
      setShareMessage("Access granted to " + result.member.email + " as " + result.member.role + ".");
      setInviteEmail("");
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
      setShareMessage("Link copied. The recipient must sign in and have access to this document.");
    } catch {
      setShareMessage("Copy failed. Copy the URL from your browser address bar after selecting the document.");
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
        <div className="sidebar-bottom"><span className="avatar">B</span><div><strong>{signedIn ? "Signed-in account" : "Local workspace"}</strong><small>{signedIn ? "Authenticated session" : "Development session"}</small></div><span className="more">···</span></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Personal workspace</span><span className="slash">/</span><strong>{active?.title || "Documents"}</strong></div>
          <div className="top-actions"><span className="secure-label"><span className="green-dot" /> Autosave enabled</span><button className="share-button" onClick={() => { setShareMessage(""); setShareOpen(true); }} disabled={!active || active.role !== "owner"}>↗ Share</button>
            {process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL && (signedIn
              ? <button className="auth-button" onClick={signOut}>Sign out</button>
              : <button className="auth-button" onClick={signIn}>Sign in</button>)}
            <span className="avatar small-avatar">B</span></div>
        </header>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {active ? <CollabEditor key={active.id} documentId={active.id} initialTitle={active.title} apiBase={API} readOnly={active.role === "viewer"} onTitleChange={(title) => setDocuments((list) => list.map((d) => d.id === active.id ? { ...d, title } : d))} /> : (
          <div className="empty-state">
            <div className="empty-art"><div className="art-sheet"><span /><span /><span /><span /></div><div className="art-bubble bubble-one">A</div><div className="art-bubble bubble-two">B</div><div className="art-cursor">✦</div></div>
            <div className="eyebrow">A LITTLE MORE IN SYNC</div>
            <h1>Good ideas are better <em>together.</em></h1>
            <p>Create a document and invite your thoughts in. Changes sync live, and your work stays available offline.</p>
            <button className="primary-button" onClick={createDocument} disabled={creating}>{creating ? "Creating…" : "Create your first document"} <span>→</span></button>
            <div className="feature-row"><span>✳ Real-time collaboration</span><span>◉ Offline-ready</span><span>⌁ Built to keep up</span></div>
          </div>
        )}
        {shareOpen && active && (
          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }}>
            <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <div className="modal-heading">
                <div><div className="eyebrow">COLLABORATION</div><h2 id="share-title">Share document</h2></div>
                <button className="modal-close" onClick={() => setShareOpen(false)} aria-label="Close share dialog">×</button>
              </div>
              <p className="modal-copy">Add a person who has already signed in to Collab Docs. Their role controls whether they can edit or only read.</p>
              <form className="share-form" onSubmit={(event) => { event.preventDefault(); void shareDocument(); }}>
                <label htmlFor="invite-email">Email address</label>
                <input id="invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
                <label htmlFor="invite-role">Permission</label>
                <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}>
                  <option value="editor">Can edit</option><option value="viewer">Can view</option>
                </select>
                <div className="share-feedback" role="status">{shareMessage}</div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyDocumentLink()}>Copy link</button>
                  <button type="button" className="secondary-button" onClick={() => setShareOpen(false)}>Close</button>
                  <button type="submit" className="primary-button" disabled={sharing}>{sharing ? "Sharing…" : "Grant access"} <span>→</span></button>
                </div>
              </form>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
