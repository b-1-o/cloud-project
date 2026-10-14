"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function PublicViewer() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [title, setTitle] = useState("Loading…");
  const [error, setError] = useState("");
  const [doc] = useState(() => new Y.Doc());

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit.configure({ history: false }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({ document: doc }),
    ],
    editorProps: { attributes: { class: "tiptap-editor" } },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError("Missing share token");
        return;
      }
      try {
        const res = await fetch(API + "/api/public/" + encodeURIComponent(token));
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || "Document not found");
        }
        const data = (await res.json()) as {
          document: { title: string };
          state: string;
        };
        if (cancelled) return;
        setTitle(data.document.title);
        if (data.state) Y.applyUpdate(doc, decode(data.state));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, doc]);

  return (
    <main className="shell public-shell">
      <header className="public-bar">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>
          <span>
            collab<span className="brand-light">docs</span>
          </span>
        </a>
        <span className="public-badge">Public · view only</span>
      </header>
      {error ? (
        <div className="empty-state">
          <h1>Link unavailable</h1>
          <p>{error}</p>
        </div>
      ) : (
        <div className="editor-layout public-editor">
          <div className="editor-meta">
            <div className="doc-badge">DOC</div>
            <div className="editor-title-wrap">
              <div className="editor-subtitle">SHARED DOCUMENT</div>
              <h1 className="public-title">{title}</h1>
            </div>
          </div>
          <div className="paper-wrap">
            <div className="paper paper-a4">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PublicDocumentPage() {
  return (
    <Suspense fallback={<main className="shell public-shell"><p className="list-placeholder">Loading…</p></main>}>
      <PublicViewer />
    </Suspense>
  );
}
