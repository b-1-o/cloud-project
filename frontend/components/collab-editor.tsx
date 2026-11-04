"use client";

import { useEffect, useRef, useState } from "react";
import { CheckSquare, Circle, Code2, Download, Eraser, FileText, Highlighter, History, ImagePlus, List, ListOrdered, ListTodo, MessageCircle, MessageSquare, Minus, PenLine, Quote, Redo2, Search, Square, Type, Undo2, X } from "lucide-react";
import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { toast } from "sonner";
import * as Y from "yjs";
import { getAccessToken } from "@/lib/auth";
import { IndexeddbPersistence } from "y-indexeddb";
import { SlashMenu } from "@/components/slash-menu";
import { SignatureDialog } from "@/components/signature-dialog";
import { DocumentAnnotation } from "@/components/document-annotation";
import { AnnotationDrawingDialog } from "@/components/annotation-drawing-dialog";

type Props = {
  documentId: string;
  initialTitle: string;
  initialContent?: string;
  onInitialContentApplied?: () => void;
  apiBase: string;
  localOnly?: boolean;
  readOnly?: boolean;
  openCommentsOnMount?: boolean;
  openingFromSheet?: boolean;
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
  initialContent,
  onInitialContentApplied,
  apiBase,
  localOnly = false,
  readOnly = false,
  openCommentsOnMount = false,
  openingFromSheet = false,
  onTitleChange,
  onDeleteRequest,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline" | "local">("connecting");
  const [wordCount, setWordCount] = useState(0);
  const [doc] = useState(() => new Y.Doc());
  const [undoManager] = useState(() => new Y.UndoManager(doc.getXmlFragment("default")));
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; body: string; author_name?: string; resolved?: number }>>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentPosting, setCommentPosting] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; created_at: string; label?: string }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [drawingMode, setDrawingMode] = useState<"draw" | "highlight" | null>(null);
  const [annotationTextKind, setAnnotationTextKind] = useState<"text" | "comment" | null>(null);
  const [annotationText, setAnnotationText] = useState("");
  const annotationImageInput = useRef<HTMLInputElement>(null);
  const importedContentApplied = useRef(false);
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
        Image.configure({ inline: false, allowBase64: true }),
        DocumentAnnotation,
        Placeholder.configure({ placeholder: "Type / for commands, or start writing…" }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc }),
      ],
      editorProps: {
        attributes: { class: "tiptap-editor", "aria-label": "Document editor", spellcheck: "true" },
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
    if (!editor || !initialContent || importedContentApplied.current || readOnly) return;
    importedContentApplied.current = true;
    editor.commands.setContent(initialContent);
    onInitialContentApplied?.();
  }, [editor, initialContent, readOnly, onInitialContentApplied]);

  useEffect(() => {
    if (!openingFromSheet) return;
    const frame = window.requestAnimationFrame(() => {
      const mainPanel = document.querySelector<HTMLElement>(".main-panel");
      const paperWrap = document.querySelector<HTMLElement>(".paper-wrap");
      if (mainPanel) {
        mainPanel.scrollTop = 0;
        mainPanel.scrollLeft = 0;
      }
      if (paperWrap) {
        paperWrap.scrollTop = 0;
        paperWrap.scrollLeft = 0;
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [documentId, openingFromSheet]);

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

    if (localOnly) {
      setConnection("local");
      void persistence.whenSynced.then(() => {
        if (!disposed) setConnection("local");
      });
      return () => {
        disposed = true;
        if (titleTimer.current) clearTimeout(titleTimer.current);
        titleTimer.current = null;
        persistence.destroy();
        undoManager.destroy();
        doc.destroy();
      };
    }

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
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: unknown };
          if (response.status >= 400 && response.status < 500) {
            connecting = false;
            if (!disposed) {
              setConnection("offline");
              const message = response.status === 401
                ? "Authentication required. Please sign in to continue."
                : typeof body.error === "string"
                  ? body.error
                  : "This document is not available to your account.";
              toast.error(response.status === 401 ? "Sign-in required" : "Unable to connect", {
                description: message,
              });
            }
            return;
          }
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "Collaboration ticket request failed (" + response.status + ")",
          );
        }
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
  }, [apiBase, documentId, doc, undoManager, localOnly]);

  function changeTitle(value: string) {
    if (readOnly) return;
    const next = value.slice(0, 120);
    setTitle(next);
    onTitleChange(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = null;
    if (localOnly) return;
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

  function insertAnnotation(attrs: Record<string, string | number | boolean>) {
    if (!editor || readOnly) return;
    editor.chain().focus().insertContent({ type: "documentAnnotation", attrs }).run();
  }

  function openAnnotationText(kind: "text" | "comment") {
    if (readOnly) return;
    setAnnotationTextKind(kind);
    setAnnotationText("");
  }

  function insertAnnotationText() {
    const text = annotationText.trim();
    if (!text || !annotationTextKind) return;
    insertAnnotation({
      kind: annotationTextKind,
      text,
      width: annotationTextKind === "comment" ? 340 : 320,
      height: annotationTextKind === "comment" ? 136 : 64,
      color: "#444444",
    });
    setAnnotationText("");
    setAnnotationTextKind(null);
    toast.success(annotationTextKind === "comment" ? "Note inserted" : "Text inserted");
  }

  function handleAnnotationImage(file?: File) {
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      toast.error("Choose a PNG or JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      insertAnnotation({
        kind: "image",
        dataUrl: reader.result,
        mimeType: file.type,
        width: 360,
        height: 240,
      });
      toast.success("Image inserted");
    };
    reader.onerror = () => toast.error("The selected image could not be read.");
    reader.readAsDataURL(file);
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
    if (localOnly) {
      toast.info("Sign in to share a document link.");
      return;
    }
    const link = new URL("/", window.location.origin);
    link.searchParams.set("doc", documentId);
    void navigator.clipboard.writeText(link.toString()).then(
      () => toast.success("App link copied — opens this document"),
      () => toast.error("Could not copy link")
    );
  }

  async function loadComments() {
    if (localOnly) {
      toast.info("Sign in to use document comments.");
      return;
    }
    setCommentsLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/comments", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (!res.ok) throw new Error("Could not load comments (" + res.status + ")");
      const data = (await res.json()) as { comments: Array<{ id: string; body: string; author_name?: string; resolved?: number }> };
      setComments(data.comments || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load comments");
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
    if (localOnly) {
      toast.info("Sign in to use document comments.");
      return;
    }
    const body = commentDraft.trim();
    if (!body || commentPosting) return;
    setCommentPosting(true);
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
      if (!res.ok) throw new Error("Could not post comment (" + res.status + ")");
      setCommentDraft("");
      toast.success("Comment added");
      await loadComments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post comment");
    } finally {
      setCommentPosting(false);
    }
  }

  async function loadVersions() {
    if (localOnly) {
      toast.info("Sign in to use version history.");
      return;
    }
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
    if (localOnly) {
      toast.info("Sign in to use version history.");
      return;
    }
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

  function replaceAllMatches() {
    if (!editor || !findQuery) return;
    const matches: Array<{ from: number; to: number }> = [];
    editor.state.doc.descendants((node, position) => {
      if (!node.isText || !node.text) return;
      let index = node.text.indexOf(findQuery);
      while (index >= 0) {
        matches.push({ from: position + index, to: position + index + findQuery.length });
        index = node.text.indexOf(findQuery, index + Math.max(1, findQuery.length));
      }
    });
    if (!matches.length) {
      toast.message("No matches to replace");
      return;
    }
    const transaction = editor.state.tr;
    for (const match of matches.reverse()) {
      transaction.insertText(replaceQuery, match.from, match.to);
    }
    editor.view.dispatch(transaction);
    toast.success("Replaced " + matches.length + (matches.length === 1 ? " match" : " matches"));
  }

  function toolClass(active: boolean) {
    return active ? "tool active-tool" : "tool";
  }

  const pageEstimate = Math.max(1, Math.ceil(wordCount / 400));

  return (
    <div className={"editor-layout" + (focusMode ? " focus-mode" : "")}>
      {!focusMode && (
        <div className="editor-meta">
          <div className="editor-title-wrap">
            <input className="title-input" aria-label="Document title" value={title} maxLength={120} readOnly={readOnly} onChange={(e) => changeTitle(e.target.value)} />
          </div>
          <div className="editor-meta-actions" ref={menuRef}>
            <button type="button" className="editor-more-btn" aria-label="Document menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>···</button>
            {menuOpen && (
              <div className="editor-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); copyShareLink(); }}>Copy app link</button>
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
            <button type="button" className="tool" onClick={() => undoManager.undo()} disabled={readOnly} aria-label="Undo" title="Undo"><Undo2 size={15} strokeWidth={1.8} /></button>
            <button type="button" className="tool" onClick={() => undoManager.redo()} disabled={readOnly} aria-label="Redo" title="Redo"><Redo2 size={15} strokeWidth={1.8} /></button>
            <span className="tool-divider" />
            <button type="button" className={toolClass(editor?.isActive("bold") ?? false)} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={readOnly} aria-label="Bold"><strong>B</strong></button>
            <button type="button" className={toolClass(editor?.isActive("italic") ?? false)} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={readOnly} aria-label="Italic"><em>I</em></button>
            <button type="button" className={toolClass(editor?.isActive("underline") ?? false)} onClick={() => editor?.chain().focus().toggleUnderline().run()} disabled={readOnly} aria-label="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
            <button type="button" className={toolClass(editor?.isActive("strike") ?? false)} onClick={() => editor?.chain().focus().toggleStrike().run()} disabled={readOnly} aria-label="Strikethrough"><span style={{ textDecoration: "line-through" }}>S</span></button>
            <button type="button" className={toolClass(editor?.isActive("highlight") ?? false)} onClick={() => editor?.chain().focus().toggleHighlight().run()} disabled={readOnly} aria-label="Highlight"><Highlighter size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("code") ?? false)} onClick={() => editor?.chain().focus().toggleCode().run()} disabled={readOnly} aria-label="Inline code"><Code2 size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("link") ?? false)} onClick={setLink} disabled={readOnly} aria-label="Link">Link</button>
            <span className="tool-divider" />
            <button type="button" className={toolClass(editor?.isActive("heading", { level: 1 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} disabled={readOnly} aria-label="Heading 1">H1</button>
            <button type="button" className={toolClass(editor?.isActive("heading", { level: 2 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={readOnly} aria-label="Heading 2">H2</button>
            <button type="button" className={toolClass(editor?.isActive("heading", { level: 3 }) ?? false)} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} disabled={readOnly} aria-label="Heading 3">H3</button>
            <span className="tool-divider" />
            <button type="button" className={toolClass(editor?.isActive("bulletList") ?? false)} onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={readOnly} aria-label="Bullet list" title="Bulleted list"><List size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("orderedList") ?? false)} onClick={() => editor?.chain().focus().toggleOrderedList().run()} disabled={readOnly} aria-label="Ordered list" title="Numbered list"><ListOrdered size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("taskList") ?? false)} onClick={() => editor?.chain().focus().toggleTaskList().run()} disabled={readOnly} aria-label="Checklist"><ListTodo size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("blockquote") ?? false)} onClick={() => editor?.chain().focus().toggleBlockquote().run()} disabled={readOnly} aria-label="Quote"><Quote size={15} strokeWidth={1.8} /></button>
            <button type="button" className={toolClass(editor?.isActive("codeBlock") ?? false)} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} disabled={readOnly} aria-label="Code block">Code</button>
            <span className="tool-divider" />
            <button type="button" className="tool" onClick={() => editor?.chain().focus().setHorizontalRule().run()} disabled={readOnly} aria-label="Horizontal rule"><Minus size={15} strokeWidth={1.8} /></button>
            <button type="button" className="tool" onClick={() => setFindOpen(true)} aria-label="Find" title="Find (⌘F)">Find</button>
          </div>
          <div className="connection-status" role="status" aria-live="polite">
            <span className={"status-dot " + connection} />
            {connection === "live" ? "Live sync" : connection === "local" ? "Local · saved on device" : connection === "offline" ? "Offline · saved locally" : "Connecting…"}
          </div>
        </div>
      )}
      {!focusMode && (
        <div className="editor-annotation-toolbar" role="toolbar" aria-label="Document annotations">
          <div className="editor-annotation-group">
            <span className="editor-annotation-label">ANNOTATE</span>
            <button type="button" className="annotation-tool-button" onClick={() => setDrawingMode("draw")} disabled={readOnly} aria-label="Draw annotation" title="Freehand drawing"><PenLine size={15} /><span>Draw</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => setDrawingMode("highlight")} disabled={readOnly} aria-label="Highlight annotation" title="Freehand highlight"><Highlighter size={15} /><span>Highlight</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => setSignatureOpen(true)} disabled={readOnly} aria-label="Insert signature" title="Create and insert a signature"><PenLine size={15} /><span>Signature</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => openAnnotationText("text")} disabled={readOnly} aria-label="Insert text annotation" title="Insert movable text"><Type size={15} /><span>Text</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => insertAnnotation({ kind: "checkbox", checked: false, text: "Checklist item", width: 300, height: 48, color: "#444444" })} disabled={readOnly} aria-label="Insert checkbox" title="Insert checkbox"><CheckSquare size={15} /><span>Checkbox</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => insertAnnotation({ kind: "shape", shape: "rectangle", width: 280, height: 120, color: "#555555" })} disabled={readOnly} aria-label="Insert rectangle" title="Insert rectangle"><Square size={15} /><span>Rectangle</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => insertAnnotation({ kind: "shape", shape: "ellipse", width: 260, height: 120, color: "#555555" })} disabled={readOnly} aria-label="Insert ellipse" title="Insert ellipse"><Circle size={15} /><span>Ellipse</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => insertAnnotation({ kind: "shape", shape: "line", width: 280, height: 56, color: "#555555" })} disabled={readOnly} aria-label="Insert line" title="Insert line"><Minus size={15} /><span>Line</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => openAnnotationText("comment")} disabled={readOnly} aria-label="Insert comment note" title="Insert sticky note"><MessageSquare size={15} /><span>Note</span></button>
            <button type="button" className="annotation-tool-button" onClick={() => annotationImageInput.current?.click()} disabled={readOnly} aria-label="Insert image annotation" title="Insert image"><ImagePlus size={15} /><span>Image</span></button>
            <button type="button" className="annotation-tool-button is-danger" onClick={() => editor?.chain().focus().deleteSelection().run()} disabled={readOnly || !editor?.isActive("documentAnnotation")} aria-label="Delete selected annotation" title="Delete selected annotation"><Eraser size={15} /><span>Delete</span></button>
            <input ref={annotationImageInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { handleAnnotationImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
        </div>
      )}
      {annotationTextKind && !focusMode && (
        <form className="document-annotation-entry" onSubmit={(event) => { event.preventDefault(); insertAnnotationText(); }}>
          <input
            autoFocus
            aria-label={annotationTextKind === "comment" ? "New note text" : "New annotation text"}
            placeholder={annotationTextKind === "comment" ? "Write a note for this document…" : "Type the text to insert…"}
            value={annotationText}
            onChange={(event) => setAnnotationText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setAnnotationTextKind(null); }}
          />
          <button type="submit" className="annotation-entry-insert" disabled={!annotationText.trim()}>Insert</button>
          <button type="button" className="annotation-entry-cancel" onClick={() => setAnnotationTextKind(null)}>Cancel</button>
        </form>
      )}
      {focusMode && (
        <button type="button" className="focus-exit" onClick={() => setFocusMode(false)}>Exit focus mode</button>
      )}
      <div className="editor-content-grid">
        <div className="editor-canvas-column">
        <div className="paper-wrap">
          <div className={"paper paper-a4" + (openingFromSheet ? " paper-shared-transition" : "")}>
            {editor && (
              <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} className="bubble-menu">
                <button type="button" className={toolClass(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><strong>B</strong></button>
                <button type="button" className={toolClass(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><em>I</em></button>
                <button type="button" className={toolClass(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
                <button type="button" className={toolClass(editor.isActive("highlight"))} onClick={() => editor.chain().focus().toggleHighlight().run()} aria-label="Highlight"><Highlighter size={15} strokeWidth={1.8} /></button>
                <button type="button" className={toolClass(editor.isActive("link"))} onClick={setLink} aria-label="Link">Link</button>
                <button type="button" className="tool" onClick={() => { setCommentsOpen(true); void loadComments(); }} aria-label="Add comment"><MessageCircle size={14} strokeWidth={1.8} /></button>
              </BubbleMenu>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
  
        </div>
        {!focusMode && (
          <aside className="editor-tools-panel" aria-label="Document tools">
            <div className="editor-tools-heading">
              <span className="eyebrow">TOOLS</span>
              <h3>Document tools</h3>
            </div>
            <section className="editor-tool-section">
              <div className="editor-tool-section-title"><Search size={14} /> Review</div>
              <button type="button" className="editor-tool-row" onClick={() => setFindOpen(true)}><Search size={15} /><span>Find and replace</span></button>
              <button type="button" className="editor-tool-row" onClick={() => { setCommentsOpen(true); void loadComments(); }}><MessageCircle size={15} /><span>Comments</span></button>
              <button type="button" className="editor-tool-row" onClick={() => { setVersionsOpen(true); void loadVersions(); }}><History size={15} /><span>Version history</span></button>
            </section>
            <section className="editor-tool-section">
              <div className="editor-tool-section-title"><PenLine size={14} /> Annotations</div>
              <p className="editor-tool-note">Add movable, resizable signatures, drawings, highlights, images, text, notes, shapes and checkboxes to the document.</p>
              <button type="button" className="editor-tool-primary" onClick={() => setSignatureOpen(true)} disabled={readOnly}><PenLine size={15} /> Draw signature</button>
              <button type="button" className="editor-tool-row" onClick={() => setDrawingMode("draw")} disabled={readOnly}><PenLine size={15} /><span>Draw on document</span></button>
              <button type="button" className="editor-tool-row" onClick={() => openAnnotationText("comment")} disabled={readOnly}><MessageSquare size={15} /><span>Add a note</span></button>
            </section>
            <section className="editor-tool-section">
              <div className="editor-tool-section-title"><Download size={14} /> Export</div>
              <button type="button" className="editor-tool-row" onClick={exportPdf}><FileText size={15} /><span>Save as PDF</span></button>
              <button type="button" className="editor-tool-row" onClick={exportDocxLike}><Download size={15} /><span>Word-compatible file (.doc)</span></button>
              <button type="button" className="editor-tool-row" onClick={exportHtml}><Download size={15} /><span>HTML file</span></button>
              <button type="button" className="editor-tool-row" onClick={exportMarkdown}><Download size={15} /><span>Markdown file</span></button>
            </section>
          </aside>
        )}
      </div>
      {signatureOpen && <SignatureDialog onClose={() => setSignatureOpen(false)} onInsert={(src) => { insertAnnotation({ kind: "signature", dataUrl: src, mimeType: "image/png", width: 320, height: 108 }); setSignatureOpen(false); toast.success("Signature inserted"); }} />}
      {drawingMode && <AnnotationDrawingDialog mode={drawingMode} onClose={() => setDrawingMode(null)} onInsert={(src) => { insertAnnotation({ kind: drawingMode, dataUrl: src, mimeType: "image/png", width: drawingMode === "highlight" ? 460 : 320, height: drawingMode === "highlight" ? 172 : 120 }); setDrawingMode(null); toast.success(drawingMode === "highlight" ? "Highlight inserted" : "Drawing inserted"); }} />}
      <SlashMenu editor={editor} open={slashOpen && !readOnly} query={slashQuery} position={slashPos} onClose={() => { setSlashOpen(false); setSlashQuery(""); }} />
      {findOpen && (
        <div className="find-bar" role="search">
          <input value={findQuery} onChange={(e) => setFindQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runFind(); if (e.key === "Escape") setFindOpen(false); }} placeholder="Find text…" aria-label="Find in document" autoFocus />
          <input value={replaceQuery} onChange={(e) => setReplaceQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") replaceAllMatches(); if (e.key === "Escape") setFindOpen(false); }} placeholder="Replace with…" aria-label="Replacement text" />
          <button type="button" className="secondary-button" onClick={runFind}>Find next</button>
          <button type="button" className="secondary-button" onClick={replaceAllMatches} disabled={readOnly}>Replace all</button>
          <button type="button" className="secondary-button" onClick={() => setFindOpen(false)}>Close</button>
        </div>
      )}
      {commentsOpen && (
        <aside className="comments-panel" aria-label="Comments">
          <div className="comments-header">
            <strong>Comments</strong>
            <button type="button" className="modal-close" onClick={() => setCommentsOpen(false)} aria-label="Close comments"><X size={15} /></button>
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
          <div className="comment-compose">
            <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Write a comment…" rows={3} aria-label="Comment text" />
            <button type="button" className="primary-button" onClick={() => void submitComment()} disabled={!commentDraft.trim() || commentPosting}>
              {commentPosting ? "Posting…" : "Post comment"}
            </button>
          </div>
        </aside>
      )}
      {versionsOpen && (
        <aside className="comments-panel" aria-label="Version history">
          <div className="comments-header">
            <strong>Versions</strong>
            <button type="button" className="modal-close" onClick={() => setVersionsOpen(false)} aria-label="Close versions"><X size={15} /></button>
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
        <span>{wordCount} words <i>·</i> ~{pageEstimate} page{pageEstimate === 1 ? "" : "s"} <i>·</i> {connection === "local" ? "Local mode" : connection === "offline" ? "Offline mode" : "Private workspace"}</span>
      </footer>
    </div>
  );
}
