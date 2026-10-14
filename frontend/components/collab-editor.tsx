"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

type Props = { documentId: string; initialTitle: string; apiBase: string; onTitleChange: (title: string) => void };
type TicketResponse = { ticket: string };

function encode(data: Uint8Array) {
  let binary = "";
  for (let i = 0; i < data.length; i += 1) binary += String.fromCharCode(data[i]);
  return btoa(binary);
}
function decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function CollabEditor({ documentId, initialTitle, apiBase, onTitleChange }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [wordCount, setWordCount] = useState(0);
  const [doc] = useState(() => new Y.Doc());
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ history: false }), Collaboration.configure({ document: doc })],
    editorProps: { attributes: { class: "tiptap-editor", "aria-label": "Document editor" } },
    onUpdate: ({ editor: instance }) => {
      const text = instance.getText().trim();
      setWordCount(text ? text.split(/\s+/).length : 0);
    },
  }, [doc]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    const persistence = new IndexeddbPersistence("collab-docs-" + documentId, doc);

    async function connect() {
      await persistence.whenSynced;
      if (disposed) return;
      try {
        const response = await fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId) + "/ticket", { method: "POST" });
        if (!response.ok) throw new Error("Ticket request failed");
        const { ticket } = await response.json() as TicketResponse;
        const url = new URL(apiBase || window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = "/api/documents/" + encodeURIComponent(documentId) + "/socket";
        url.search = "?ticket=" + encodeURIComponent(ticket);
        socket = new WebSocket(url.toString());
        socket.onopen = () => {
          setConnection("live");
          socket?.send(JSON.stringify({ type: "sync", state: encode(Y.encodeStateAsUpdate(doc)) }));
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { type: string; update?: string; state?: string };
            if (message.type === "sync" && message.state) Y.applyUpdate(doc, decode(message.state), "remote");
            if (message.type === "update" && message.update) Y.applyUpdate(doc, decode(message.update), "remote");
          } catch (err) {
            console.error("Invalid collaboration message", err);
          }
        };
        socket.onclose = () => { if (!disposed) setConnection("offline"); };
        socket.onerror = () => { if (!disposed) setConnection("offline"); };
      } catch (err) {
        console.error("Collaboration connection failed", err);
        setConnection("offline");
      }
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || disposed) return;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "update", update: encode(update) }));
    };
    doc.on("update", onUpdate);
    void connect();
    const reconnect = () => {
      if (!disposed && (!socket || socket.readyState === WebSocket.CLOSED)) void connect();
    };
    window.addEventListener("online", reconnect);

    return () => {
      disposed = true;
      window.removeEventListener("online", reconnect);
      doc.off("update", onUpdate);
      socket?.close();
      persistence.destroy();
      doc.destroy();
    };
  }, [apiBase, documentId, doc]);

  function changeTitle(value: string) {
    const next = value.slice(0, 120);
    setTitle(next);
    onTitleChange(next);
    const timerKey = "collab-docs-title-" + documentId;
    window.clearTimeout(Number(sessionStorage.getItem(timerKey) || 0));
    const timer = window.setTimeout(() => {
      void fetch(apiBase + "/api/documents/" + encodeURIComponent(documentId), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }),
      }).catch(() => undefined);
    }, 350);
    sessionStorage.setItem(timerKey, String(timer));
  }

  return (
    <div className="editor-layout">
      <div className="editor-meta"><div className="doc-badge">DOC</div><div><div className="editor-subtitle">DOCUMENT</div><input className="title-input" aria-label="Document title" value={title} onChange={(event) => changeTitle(event.target.value)} /></div></div>
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button className={editor?.isActive("bold") ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold"><strong>B</strong></button>
          <button className={editor?.isActive("italic") ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic"><em>I</em></button>
          <span className="tool-divider" />
          <button className={editor?.isActive("heading", { level: 1 }) ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="Heading 1">H1</button>
          <button className={editor?.isActive("heading", { level: 2 }) ? "tool active-tool" : "tool"} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading 2">H2</button>
          <span className="tool-divider" />
          <button className="tool" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="Bullet list">☷</button>
          <button className="tool" onClick={() => editor?.chain().focus().toggleBlockquote().run()} aria-label="Quote">❞</button>
        </div>
        <div className="connection-status"><span className={"status-dot " + connection} />{connection === "live" ? "Live sync" : connection === "offline" ? "Offline · saved locally" : "Connecting…"}</div>
      </div>
      <div className="paper-wrap"><div className="paper"><EditorContent editor={editor} /></div></div>
      <footer className="editor-footer"><span><span className="green-dot" /> {connection === "live" ? "All changes synced" : "Changes saved on this device"}</span><span>{wordCount} words <i>·</i> {connection === "offline" ? "Offline mode" : "Private workspace"}</span></footer>
    </div>
  );
}
