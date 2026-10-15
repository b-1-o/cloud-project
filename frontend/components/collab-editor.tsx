"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import { toast } from "sonner";
import * as Y from "yjs";
import { getAccessToken } from "@/lib/auth";
import { IndexeddbPersistence } from "y-indexeddb";
import { SlashMenu } from "@/components/slash-menu";

type Props = {
  documentId: string;
  initialTitle: string;
  apiBase: string;
  readOnly?: boolean;
  openCommentsOnMount?: boolean;
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
  openCommentsOnMount = false,
  onTitleChange,
  onDeleteRequest,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [wordCount, setWordCount] = useState(0);
  const [doc] = useState(() => new Y.Doc());
  const [undoManager] = useState(() => new Y.UndoManager(doc.getXmlFragment("default")));
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; body: string; author_name?: string; resolved?: number }>>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; created_at: string; label?: string }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ history: false }),
        Underline,
        Link.configure({ openOnClick: false, HTMLAttributes: { class: "editor-link" } }),
        Highlight.configure({ multicolor: false }),
        Placeholder.configure({ placeholder: "Type / for commands, or start writing…" }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
      ],
      editorProps: {
        attributes: { class: "tiptap-editor", "aria-label": "Document editor" },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            setFindOpen(true);
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === ".") {
            event.preventDefault();
            setFocusMode((v) => !v);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: instance }) => {
        const text = instance.getText().trim();
        setWordCount(text ? text.split(/\s+/).length : 0);
        if (readOnly) return;
        const { from } = instance.state.selection;
        const textBefore = instance.state.doc.textBetween(Math.max(0, from - 32), from, "\n", "\n");
        const match = textBefore.match(/(?:^|\n)\/([^\n]*)$/);
        if (match) {
          setSlashQuery(match[1] || "");
          setSlashOpen(true);
          try {
            const coords = instance.view.coordsAtPos(from);
            setSlashPos({ top: coords.bottom + 8 + window.scrollY, left: coords.left + window.scrollX });
          } catch {
            setSlashPos({ top: 120, left: 120 });
          }
        } else if (slashOpen) {
          setSlashOpen(false);
          setSlashQuery("");
        }
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
            if (message.type === "pong") {
              lastPongAt = Date.now();
              return;
            }
            if (message.type === "sync" && message.state) Y.applyUpdate(doc, decode(message.state), "remote");
            if (message.type === "update" && message.update) Y.applyUpdate(doc, decode(message.update), "remote");
          } catch {
            /* ignore */
          }
        };
        socket.onclose = () => {
          connecting = false;
          if (!disposed) scheduleReconnect();
        };
        socket.onerror = () => {
          connecting = false;
          try {
            socket?.close();
          } catch {
            /* */
          }
          scheduleReconnect();
        };
      } catch {
        connecting = false;
        if (!disposed) scheduleReconnect();
      }
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || disposed || socket?.readyState !== WebSocket.OPEN) return;
      try {
        const encoded = encode(update);
        if (encoded.length > MAX_ENCODED_UPDATE) {
          socket.close(1009, "Update is too large");
          return;
        }
        socket.send(JSON.stringify({ type: "update", update: encoded }));
      } catch {
        socket?.close(1009, "Update encoding failed");
      }
    };

    const heartbeat = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        if (lastPongAt > 0 && Date.now() - lastPongAt > 55_000) {
          socket.close(4000, "Heartbeat timeout");
          return;
        }
        try {
          socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
        } catch {
          socket.close();
        }
      }
    }, 25_000);

    const reconnectWhenOnline = () => {
      if (disposed) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (socket?.readyState === WebSocket.OPEN) return;
      try {
        socket?.close();
      } catch {
        /* */
      }
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
      try {
        socket?.close(1000, "Document editor unmounted");
      } catch {
        /* */
      }
      persistence.destroy();
      undoManager.destroy();
      doc.destroy();
    };
  }, [apiBase, documentId, doc, undoManager]);

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
        .catch(() => {
          /* retry on next edit */
        });
    }, 350);
  }

  function safeName() {
    return (title || "document").replace(/[^\w\s-]/g, "").trim() || "document";
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
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>' +
      title.replace(/</g, "") +
      "</title><style>body{font-family:Georgia,serif;max-width:794px;margin:40px auto;line-height:1.7;color:#222}</style></head><body><h1>" +
      title.replace(/</g, "") +
      "</h1>" +
      body +
      "</body></html>";
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
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' +
      title.replace(/</g, "") +
      "</title></head><body><h1>" +
      title.replace(/</g, "") +
      "</h1>" +
      body +
      "</body></html>";
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

  async function loadComments() {
    setCommentsLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/comments", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!res.ok) throw new Error("Could not load comments");
      const data = (await res.json()) as { comments: Array<{ id: string; body: string; author_name?: string; resolved?: number }> };
      setComments(data.comments || []);
    } catch {
      toast.error("Could not load comments");
    } finally {
      setCommentsLoading(false);
    }
  }

  useEffect(() => {
    if (!openCommentsOnMount) return;
    setCommentsOpen(true);
    void loadComments();
    // This handler belongs to this editor instance; documentId defines its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, openCommentsOnMount]);

  async function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Could not post comment");
      setCommentDraft("");
      toast.success("Comment added");
      await loadComments();
    } catch {
      toast.error("Could not post comment");
    }
  }

  async function loadVersions() {
    setVersionsLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/versions", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!res.ok) throw new Error("Could not load versions");
      const data = (await res.json()) as { versions: Array<{ id: string; created_at: string; label?: string }> };
      setVersions(data.versions || []);
    } catch {
      toast.error("Could not load version history");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function createSnapshot() {
    try {
      const token = await getAccessToken();
      const res = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/versions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ label: "Manual snapshot" }),
      });
      if (!res.ok) throw new Error("Could not create snapshot");
      toast.success("Snapshot saved");
      await loadVersions();
    } catch {
      toast.error("Could not create snapshot");
    }
  }

  function setLink() {
    if (!editor || readOnly) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  function runFind() {
    if (!editor || !findQuery.trim()) return;
    const q = findQuery.trim().toLowerCase();
    let foundFrom = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (foundFrom >= 0 || !node.isText || !node.text) return;
      const local = node.text.toLowerCase().indexOf(q);
      if (local >= 0) foundFrom = nodePos + local;
    });
    if (foundFrom >= 0) {
      editor.chain().focus().setTextSelection({ from: foundFrom, to: foundFrom + q.length }).run();
      toast.success("Found");
    } else {
      toast.message("No matches");
    }
  }

  function toolClass(active: boolean) {
    return active ? "tool active-tool" : "tool";
  }

  const pageEstimate = Math.max(1, Math.ceil(wordCount / 400));

  return (
    <div className={"editor-layout" + (focusMode ? " focus-mode" : "")}>
      {!focusMode && (
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
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setCommentsOpen(true); void loadComments(); }}>Comments</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setVersionsOpen(true); void loadVersions(); }}>Version history</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setFocusMode(true); }}>Focus mode</button>
                <div className="context-divider" />
                <button type="button" role="menuitem" className="danger-item" disabled={readOnly || !onDeleteRequest} onClick={() => { setMenuOpen(false); onDeleteRequest?.(); }}>Delete document…</button>
              </div>
            )}
          </div>
        </div>
      )}
      {!focusMode && (
        <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
          <div className="toolbar-left">
            <button type="button" className="tool" onClick={() => undoManager.undo()} disabled={readOnly} aria-label="Undo" title="Undo">↶</button>
            <button type="button" className="tool" onClick={() => undoManager.redo()} disabled={readOnly} aria-label="Redo" title="Redo">↷</button>
            <span className="tool-divider" />
            <button type="button" className={toolClass(editor?.isActive("bold") ?? false)} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={readOnly} aria-label="Bold"><strong>B</strong></button>
            <button type="button" className={toolClass(editor?.isActive("italic") ?? false)} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={readOnly} aria-label="Italic"><em>I</em></button>
            <button type="button" className={toolClass(editor?.isActive("underline") ?? false)} onClick={() => editor?.chain().focus().toggleUnderline().run()} disabled={readOnly} aria-label="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
            <button type="button" className={toolClass(editor?.isActive("strike") ?? false)} onClick={() => editor?.chain().focus().toggleStrike().run()} disabled={readOnly} aria-label="Strikethrough"><span style={{ textDecoration: "line-through" }}>S</span></button>
            <button type="button" className={toolClass(editor?.isActive("highlight") ?? false)} onClick={() => editor?.chain().focus().toggleHighlight().run()} disabled={readOnly} aria-label="Highlight">▮</button>
            <button type="button" className={toolClass(editor?.isActive("code") ?? false)} onClick={() => editor?.chain().focus().toggleCode().run()} disabled={readOnly} aria-label="Inline code">{"</>"}</button>
            <button type="button" className={toolClass(editor?.isActive("link") ?? false)} onClick={setLink} disabled={readOnly} aria-label="Link">Link</button>
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
            <button type="button" className="tool" onClick={() => setFindOpen(true)} aria-label="Find" title="Find (⌘F)">Find</button>
          </div>
          <div className="connection-status" role="status" aria-live="polite">
            <span className={"status-dot " + connection} />
            {connection === "live" ? "Live sync" : connection === "offline" ? "Offline · saved locally" : "Connecting…"}
          </div>
        </div>
      )}
      {focusMode && (
        <button type="button" className="focus-exit" onClick={() => setFocusMode(false)}>Exit focus mode</button>
      )}
      <div className="paper-wrap">
        <div className="paper paper-a4">
          {editor && (
            <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} className="bubble-menu">
              <button type="button" className={toolClass(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><strong>B</strong></button>
              <button type="button" className={toolClass(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><em>I</em></button>
              <button type="button" className={toolClass(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
              <button type="button" className={toolClass(editor.isActive("highlight"))} onClick={() => editor.chain().focus().toggleHighlight().run()} aria-label="Highlight">▮</button>
              <button type="button" className={toolClass(editor.isActive("link"))} onClick={setLink} aria-label="Link">Link</button>
              <button type="button" className="tool" onClick={() => { setCommentsOpen(true); void loadComments(); }} aria-label="Add comment">💬</button>
            </BubbleMenu>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
      <SlashMenu editor={editor} open={slashOpen && !readOnly} query={slashQuery} position={slashPos} onClose={() => { setSlashOpen(false); setSlashQuery(""); }} />
      {findOpen && (
        <div className="find-bar" role="search">
          <input value={findQuery} onChange={(e) => setFindQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runFind(); if (e.key === "Escape") setFindOpen(false); }} placeholder="Find in document…" aria-label="Find in document" autoFocus />
          <button type="button" className="secondary-button" onClick={runFind}>Find</button>
          <button type="button" className="secondary-button" onClick={() => setFindOpen(false)}>Close</button>
        </div>
      )}
      {commentsOpen && (
        <aside className="comments-panel" aria-label="Comments">
          <div className="comments-header">
            <strong>Comments</strong>
            <button type="button" className="modal-close" onClick={() => setCommentsOpen(false)} aria-label="Close comments">×</button>
          </div>
          <div className="comments-list">
            {commentsLoading && <div className="list-placeholder">Loading…</div>}
            {!commentsLoading && comments.length === 0 && <div className="list-placeholder">No comments yet.</div>}
            {comments.map((c) => (
              <div key={c.id} className={"comment-item" + (c.resolved ? " resolved" : "")}>
                <div className="comment-meta">{c.author_name || "Someone"}</div>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="comment-compose">
              <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Write a comment…" rows={3} aria-label="Comment text" />
              <button type="button" className="primary-button" onClick={() => void submitComment()} disabled={!commentDraft.trim()}>Post</button>
            </div>
          )}
        </aside>
      )}
      {versionsOpen && (
        <aside className="comments-panel" aria-label="Version history">
          <div className="comments-header">
            <strong>Versions</strong>
            <button type="button" className="modal-close" onClick={() => setVersionsOpen(false)} aria-label="Close versions">×</button>
          </div>
          <div className="comments-list">
            {versionsLoading && <div className="list-placeholder">Loading…</div>}
            {!versionsLoading && versions.length === 0 && <div className="list-placeholder">No snapshots yet.</div>}
            {versions.map((v) => (
              <div key={v.id} className="comment-item">
                <div className="comment-meta">{v.label || "Snapshot"}</div>
                <p>{new Date(v.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="comment-compose">
              <button type="button" className="primary-button" onClick={() => void createSnapshot()}>Save snapshot</button>
            </div>
          )}
        </aside>
      )}
      <footer className="editor-footer">
        <span><span className="green-dot" /> {connection === "live" ? "All changes synced" : "Changes saved on this device"}</span>
        <span>{wordCount} words <i>·</i> ~{pageEstimate} page{pageEstimate === 1 ? "" : "s"} <i>·</i> {connection === "offline" ? "Offline mode" : "Private workspace"}</span>
      </footer>
    </div>
  );
}
