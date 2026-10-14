"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { toast } from "sonner";
import * as Y from "yjs";
import { getAccessToken } from "@/lib/auth";
import { IndexeddbPersistence } from "y-indexeddb";

type Props = {
  documentId: string;
  initialTitle: string;
  apiBase: string;
  readOnly?: boolean;
  onTitleChange: (title: string) => void;
  onDeleteRequest?: () => void;
};

type TicketResponse = { ticket: string; expiresIn: number };
const MAX_ENCODED_UPDATE = 2_800_000;

function encode(data: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + chunk, data.length)));
  }
  return btoa(binary);
}

function decode(value: string) {
  if (value.length > MAX_ENCODED_UPDATE) throw new Error("Collaboration update is too large");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function CollabEditor({
  documentId,
  initialTitle,
  apiBase,
  readOnly = false,
  onTitleChange,
  onDeleteRequest,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [wordCount, setWordCount] = useState(0);
  const [doc] = useState(() => new Y.Doc());
  const [menuOpen, setMenuOpen] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ history: false }),
        Underline,
        Placeholder.configure({ placeholder: "Start writing something wonderful…" }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
      ],
      editorProps: {
        attributes: { class: "tiptap-editor", "aria-label": "Document editor" },
      },
      onUpdate: ({ editor: instance }) => {
        const text = instance.getText().trim();
        setWordCount(text ? text.split(/\s+/).length : 0);
      },
    },
    [doc, readOnly]
  );

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    let connecting = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastPongAt = 0;
    const persistence = new IndexeddbPersistence("collab-docs-" + documentId, doc);

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      setConnection("offline");
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
      reconnectAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    async function connect() {
      if (disposed || connecting) return;
      connecting = true;
      setConnection("connecting");
      try {
        await persistence.whenSynced;
        if (disposed) return;
        const token = await getAccessToken();
        const response = await fetch(
          apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/ticket",
          { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {} }
        );
        if (!response.ok) throw new Error("Collaboration ticket request failed (" + response.status + ")");
        const { ticket } = (await response.json()) as TicketResponse;
        if (disposed) return;
        const url = new URL(apiBase || window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = "/api/documents/" + encodeURIComponent(documentId) + "/socket";
        url.search = "?ticket=" + encodeURIComponent(ticket);
        socket = new WebSocket(url.toString());
        socket.onopen = () => {
          connecting = false;
          reconnectAttempt = 0;
          lastPongAt = Date.now();
          setConnection("live");
          try {
            socket?.send(JSON.stringify({ type: "sync", state: encode(Y.encodeStateAsUpdate(doc)) }));
          } catch {
            socket?.close(1009, "Local document is too large");
          }
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { type: string; update?: string; state?: string };
            if (message.type === "pong") { lastPongAt = Date.now(); return; }
            if (message.type === "sync" && message.state) Y.applyUpdate(doc, decode(message.state), "remote");
            if (message.type === "update" && message.update) Y.applyUpdate(doc, decode(message.update), "remote");
          } catch { /* ignore */ }
        };
        socket.onclose = () => { connecting = false; if (!disposed) scheduleReconnect(); };
        socket.onerror = () => { connecting = false; try { socket?.close(); } catch { /* */ } scheduleReconnect(); };
      } catch {
        connecting = false;
        if (!disposed) scheduleReconnect();
      }
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || disposed || socket?.readyState !== WebSocket.OPEN) return;
      try {
        const encoded = encode(update);
        if (encoded.length > MAX_ENCODED_UPDATE) { socket.close(1009, "Update is too large"); return; }
        socket.send(JSON.stringify({ type: "update", update: encoded }));
      } catch { socket?.close(1009, "Update encoding failed"); }
    };

    const heartbeat = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        if (lastPongAt > 0 && Date.now() - lastPongAt > 55_000) { socket.close(4000, "Heartbeat timeout"); return; }
        try { socket.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch { socket.close(); }
      }
    }, 25_000);

    const reconnectWhenOnline = () => {
      if (disposed) return;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (socket?.readyState === WebSocket.OPEN) return;
      try { socket?.close(); } catch { /* */ }
      void connect();
    };

    doc.on("update", onUpdate);
    void connect();
    window.addEventListener("online", reconnectWhenOnline);
    return () => {
      disposed = true;
      window.removeEventListener("online", reconnectWhenOnline);
      window.clearInterval(heartbeat);
      if (retryTimer) clearTimeout(retryTimer);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = null;
      doc.off("update", onUpdate);
      try { socket?.close(1000, "Document editor unmounted"); } catch { /* */ }
      persistence.destroy();
      doc.destroy();
    };
  }, [apiBase, documentId, doc]);

  function changeTitle(value: string) {
    if (readOnly) return;
    const next = value.slice(0, 120);
    setTitle(next);
    onTitleChange(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      void getAccessToken()
        .then((token) =>
          fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId), {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
              ...(token ? { Authorization: "Bearer " + token } : {}),
            },
            body: JSON.stringify({ title: next }),
          }).then((response) => {
            if (!response.ok) throw new Error("Title update failed (" + response.status + ")");
          })
        )
        .catch(() => { /* retry on next edit */ });
    }, 350);
  }

  function safeName() {
    return ((title || "document").replace(/[^\w\s-]/g, "").trim() || "document");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportMarkdown() {
    if (!editor) return;
    downloadBlob(new Blob(["# " + title + "\n\n" + editor.getText()], { type: "text/markdown;charset=utf-8" }), safeName() + ".md");
    toast.success("Exported as Markdown");
  }

  function exportHtml() {
    if (!editor) return;
    const body = editor.getHTML();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title.replace(/</g, "")}</title><style>body{font-family:Georgia,serif;max-width:794px;margin:40px auto;line-height:1.7;color:#222}</style></head><body><h1>${title.replace(/</g, "")}</h1>${body}</body></html>`;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), safeName() + ".html");
    toast.success("Exported as HTML");
  }

  function exportPdf() {
    window.print();
    toast.success("Use the print dialog → Save as PDF");
  }

  function exportDocxLike() {
    if (!editor) return;
    const body = editor.getHTML();
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title.replace(/</g, "")}</title></head><body><h1>${title.replace(/</g, "")}</h1>${body}</body></html>`;
    downloadBlob(new Blob([html], { type: "application/msword" }), safeName() + ".doc");
    toast.success("Exported as Word (.doc)");
  }

  function copyShareLink() {
    const link = new URL("/", window.location.origin);
    link.searchParams.set("doc", documentId);
    void navigator.clipboard.writeText(link.toString()).then(
      () => toast.success("App link copied — opens this document"),
      () => toast.error("Could not copy link")
    );
  }

  function toolClass(active: boolean) {
    return active ? "tool active-tool" : "tool";
  }

  return (
    <div className="editor-layout">
      <div className="editor-meta">
        <div className="doc-badge">DOC</div>
        <div className="editor-title-wrap">
          <div className="editor-subtitle">DOCUMENT</div>
          <input className="title-input" aria-label="Document title" value={title} maxLength={120} readOnly={readOnly} onChange={(e) => changeTitle(e.target.value)} />
        </div>
        <div className="editor-meta-actions" ref={menuRef}>
          <button type="button" className="editor-more-btn" aria-label="Document menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>···</button>
          {menuOpen && (
            <div className="editor-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportPdf(); }}>Export PDF…</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportDocxLike(); }}>Export Word (.doc)</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportHtml(); }}>Export HTML</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportMarkdown(); }}>Export Markdown</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); copyShareLink(); }}>Copy app link</button>
              <div className="context-divider" />
              <button type="button" role="menuitem" className="danger-item" disabled={readOnly || !onDeleteRequest} onClick={() => { setMenuOpen(false); onDeleteRequest?.(); }}>Delete document…</button>
            </div>
          )}
        </div>
      </div>
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        <div className="toolbar-left">
          <button type="button" className={toolClass(editor?.isActive("bold") ?? false)} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={readOnly} aria-label="Bold"><strong>B</strong></button>
          <button type="button" className={toolClass(editor?.isActive("italic") ?? false)} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={readOnly} aria-label="Italic"><em>I</em></button>
          <button type="button" className={toolClass(editor?.isActive("underline") ?? false)} onClick={() => editor?.chain().focus().toggleUnderline().run()} disabled={readOnly} aria-label="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
          <button type="button" className={toolClass(editor?.isActive("strike") ?? false)} onClick={() => editor?.chain().focus().toggleStrike().run()} disabled={readOnly} aria-label="Strikethrough"><span style={{ textDecoration: "line-through" }}>S</span></button>
          <button type="button" className={toolClass(editor?.isActive("code") ?? false)} onClick={() => editor?.chain().focus().toggleCode().run()} disabled={readOnly} aria-label="Inline code">{"</>"}</button>
          <span className="tool-divider" />
          <button type="button" className={toolClass(editor?.isActive("heading", { level: 1 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} disabled={readOnly} aria-label="Heading 1">H1</button>
          <button type="button" className={toolClass(editor?.isActive("heading", { level: 2 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={readOnly} aria-label="Heading 2">H2</button>
          <button type="button" className={toolClass(editor?.isActive("heading", { level: 3 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} disabled={readOnly} aria-label="Heading 3">H3</button>
          <span className="tool-divider" />
          <button type="button" className={toolClass(editor?.isActive("bulletList") ?? false)} onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={readOnly} aria-label="Bullet list">• List</button>
          <button type="button" className={toolClass(editor?.isActive("orderedList") ?? false)} onClick={() => editor?.chain().focus().toggleOrderedList().run()} disabled={readOnly} aria-label="Ordered list">1. List</button>
          <button type="button" className={toolClass(editor?.isActive("taskList") ?? false)} onClick={() => editor?.chain().focus().toggleTaskList().run()} disabled={readOnly} aria-label="Checklist">☐</button>
          <button type="button" className={toolClass(editor?.isActive("blockquote") ?? false)} onClick={() => editor?.chain().focus().toggleBlockquote().run()} disabled={readOnly} aria-label="Quote">❝</button>
          <button type="button" className={toolClass(editor?.isActive("codeBlock") ?? false)} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} disabled={readOnly} aria-label="Code block">Code</button>
          <span className="tool-divider" />
          <button type="button" className="tool" onClick={() => editor?.chain().focus().setHorizontalRule().run()} disabled={readOnly} aria-label="Horizontal rule">—</button>
        </div>
        <div className="connection-status" role="status" aria-live="polite">
          <span className={"status-dot " + connection} />
          {connection === "live" ? "Live sync" : connection === "offline" ? "Offline · saved locally" : "Connecting…"}
        </div>
      </div>
      <div className="paper-wrap">
        <div className="paper paper-a4">
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="editor-footer">
        <span><span className="green-dot" /> {connection === "live" ? "All changes synced" : "Changes saved on this device"}</span>
        <span>{wordCount} words <i>·</i> {connection === "offline" ? "Offline mode" : "Private workspace"}</span>
      </footer>
    </div>
  );
}
