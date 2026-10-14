"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { getAccessToken } from "@/lib/auth";
import { IndexeddbPersistence } from "y-indexeddb";

type Props = { documentId: string; initialTitle: string; apiBase: string; readOnly?: boolean; onTitleChange: (title: string) => void };
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

export function CollabEditor({ documentId, initialTitle, apiBase, readOnly = false, onTitleChange }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [wordCount, setWordCount] = useState(0);
  const [doc] = useState(() => new Y.Doc());
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [StarterKit.configure({ history: false }), Collaboration.configure({ document: doc })],
    editorProps: { attributes: { class: "tiptap-editor", "aria-label": "Document editor" } },
    onUpdate: ({ editor: instance }) => {
      const text = instance.getText().trim();
      setWordCount(text ? text.split(/\s+/).length : 0);
    },
  }, [doc, readOnly]);

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
      const delay = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt, 5)));
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
        const token = getAccessToken();
        const response = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/ticket", {
          method: "POST",
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!response.ok) throw new Error("Collaboration ticket request failed (" + response.status + ")");
        const { ticket } = await response.json() as TicketResponse;
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
            const message = JSON.parse(String(event.data)) as { type: string; update?: string; state?: string; error?: string };
            if (message.type === "pong") { lastPongAt = Date.now(); return; }
            if (message.type === "sync" && message.state) Y.applyUpdate(doc, decode(message.state), "remote");
            if (message.type === "update" && message.update) Y.applyUpdate(doc, decode(message.update), "remote");
            if (message.type === "error" && message.error === "read_only") setConnection("live");
          } catch (err) {
            console.error("Invalid collaboration message", err);
          }
        };
        socket.onclose = () => {
          connecting = false;
          if (!disposed) scheduleReconnect();
        };
        socket.onerror = () => {
          connecting = false;
          try { socket?.close(); } catch { /* the socket may already be closed */ }
          scheduleReconnect();
        };
      } catch (err) {
        connecting = false;
        if (!disposed) {
          console.warn("Collaboration connection unavailable; local edits remain saved", err);
          scheduleReconnect();
        }
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
        try { socket.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch { socket.close(); }
      }
    }, 25_000);

    const reconnectWhenOnline = () => {
      if (disposed) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (socket?.readyState === WebSocket.OPEN) return;
      try { socket?.close(); } catch { /* already closed */ }
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
      try { socket?.close(1000, "Document editor unmounted"); } catch { /* already closed */ }
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
      const token = getAccessToken();
      void fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ title: next }),
      }).catch((err) => console.warn("Title update failed", err));
    }, 350);
  }

  return (
    <div className="editor-layout">
      <div className="editor-meta"><div className="doc-badge">DOC</div><div><div className="editor-subtitle">DOCUMENT</div><input className="title-input" aria-label="Document title" value={title} maxLength={120} readOnly={readOnly} onChange={(event) => changeTitle(event.target.value)} /></div></div>
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button className={editor?.isActive("bold") ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={readOnly} aria-label="Bold"><strong>B</strong></button>
          <button className={editor?.isActive("italic") ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={readOnly} aria-label="Italic"><em>I</em></button>
          <span className="tool-divider" />
          <button className={editor?.isActive("heading", { level: 1 }) ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} disabled={readOnly} aria-label="Heading 1">H1</button>
          <button className={editor?.isActive("heading", { level: 2 }) ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={readOnly} aria-label="Heading 2">H2</button>
          <span className="tool-divider" />
          <button className="tool" onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={readOnly} aria-label="Bullet list">☷</button>
          <button className="tool" onClick={() => editor?.chain().focus().toggleBlockquote().run()} disabled={readOnly} aria-label="Quote">❞</button>
        </div>
        <div className="connection-status"><span className={"status-dot " + connection} />{connection === "live" ? "Live sync" : connection === "offline" ? "Offline · saved locally" : "Connecting…"}</div>
      </div>
      <div className="paper-wrap"><div className="paper"><EditorContent editor={editor} /></div></div>
      <footer className="editor-footer"><span><span className="green-dot" /> {connection === "live" ? "All changes synced" : "Changes saved on this device"}</span><span>{wordCount} words <i>·</i> {connection === "offline" ? "Offline mode" : "Private workspace"}</span></footer>
    </div>
  );
}
