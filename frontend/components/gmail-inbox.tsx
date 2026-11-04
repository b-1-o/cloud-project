"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileText, LoaderCircle, Mail, Paperclip, RefreshCw, Unplug } from "lucide-react";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => GoogleTokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    body?: { data?: string };
  };
};

type GmailAttachment = {
  messageId: string;
  attachmentId?: string;
  inlineData?: string;
  filename: string;
  mimeType: string;
  size?: number;
};

type GmailMailItem = {
  id: string;
  from: string;
  subject: string;
  date: string;
  attachments: GmailAttachment[];
};

type Props = {
  onImportFile: (file: File) => Promise<void>;
};

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function collectAttachments(messageId: string, parts: GmailPart[] = []): GmailAttachment[] {
  const output: GmailAttachment[] = [];
  const visit = (part: GmailPart) => {
    if (part.filename?.trim()) {
      output.push({
        messageId,
        attachmentId: part.body?.attachmentId,
        inlineData: part.body?.data,
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body?.size,
      });
    }
    part.parts?.forEach(visit);
  };
  parts.forEach(visit);
  return output;
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
}

export function GmailInbox({ onImportFile }: Props) {
  const [accessToken, setAccessToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [items, setItems] = useState<GmailMailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAttachment, setBusyAttachment] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (window.google?.accounts?.oauth2) {
      setScriptReady(true);
      return;
    }
    const script = existing || document.createElement("script");
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      document.head.appendChild(script);
    }
    const ready = () => setScriptReady(true);
    script.addEventListener("load", ready);
    return () => script.removeEventListener("load", ready);
  }, []);

  const gmailFetch = useCallback(async <T,>(path: string): Promise<T> => {
    if (!accessToken) throw new Error("Connect Gmail before loading attachments.");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!response.ok) {
      if (response.status === 401) {
        setAccessToken("");
        setConnected(false);
        throw new Error("Gmail access expired. Connect again to refresh your inbox.");
      }
      const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(data.error?.message || "Gmail request failed (" + response.status + ").");
    }
    return response.json() as Promise<T>;
  }, [accessToken]);

  const loadInbox = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const list = await gmailFetch<{ messages?: Array<{ id: string }> }>("messages?q=" + encodeURIComponent("has:attachment -in:spam -in:trash") + "&maxResults=12");
      const messages = await Promise.all((list.messages || []).map(async (item) => {
        const message = await gmailFetch<GmailMessage>("messages/" + encodeURIComponent(item.id) + "?format=full");
        const attachments = collectAttachments(item.id, message.payload?.parts || []);
        if (!attachments.length) return null;
        const timestamp = Number(message.internalDate || 0);
        return {
          id: item.id,
          from: header(message, "From") || "Unknown sender",
          subject: header(message, "Subject") || "No subject",
          date: timestamp ? new Date(timestamp).toLocaleDateString() : "",
          attachments,
        } satisfies GmailMailItem;
      }));
      setItems(messages.filter((item): item is GmailMailItem => item !== null));
      setConnected(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Gmail attachments.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, gmailFetch]);

  useEffect(() => {
    if (accessToken) void loadInbox();
  }, [accessToken, loadInbox]);

  const attachmentCount = useMemo(() => items.reduce((total, mail) => total + mail.attachments.length, 0), [items]);

  function connectGmail() {
    if (!CLIENT_ID) {
      setError("Gmail is not configured yet. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to the frontend environment after creating a Google OAuth web client.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setError("Google sign-in is still loading. Try again in a moment.");
      return;
    }
    setError("");
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: GMAIL_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          setError(response.error_description || response.error || "Google did not grant Gmail access.");
          return;
        }
        setAccessToken(response.access_token);
      },
      error_callback: (cause) => setError(cause.message || "Google sign-in could not be opened."),
    });
    client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  }

  function disconnectGmail() {
    if (accessToken && window.google?.accounts?.oauth2) {
      // The token is held in memory only. Disconnecting clears the app's local session.
      setAccessToken("");
    }
    setItems([]);
    setConnected(false);
    setError("");
  }

  async function importAttachment(attachment: GmailAttachment) {
    const key = attachment.messageId + ":" + attachment.filename;
    setBusyAttachment(key);
    setError("");
    try {
      let bytes: Uint8Array;
      if (attachment.attachmentId) {
        const result = await gmailFetch<{ data?: string }>(
          "messages/" + encodeURIComponent(attachment.messageId) + "/attachments/" + encodeURIComponent(attachment.attachmentId)
        );
        if (!result.data) throw new Error("Gmail returned an empty attachment.");
        bytes = decodeBase64Url(result.data);
      } else if (attachment.inlineData) {
        bytes = decodeBase64Url(attachment.inlineData);
      } else {
        throw new Error("Gmail did not return attachment data.");
      }
      const file = new File([bytes], attachment.filename, { type: attachment.mimeType });
      await onImportFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this attachment.");
    } finally {
      setBusyAttachment(null);
    }
  }

  return (
    <section className="gmail-inbox-panel" aria-labelledby="gmail-inbox-title">
      <div className="gmail-inbox-header">
        <div className="gmail-inbox-heading">
          <span className="gmail-inbox-icon"><Mail size={17} strokeWidth={1.8} /></span>
          <div>
            <span className="eyebrow">INTEGRATIONS / GMAIL</span>
            <h3 id="gmail-inbox-title">New from Gmail</h3>
            <p>Bring a file from an email straight into your workspace.</p>
          </div>
        </div>
        <div className="gmail-inbox-actions">
          {connected && <button type="button" className="gmail-icon-button" onClick={() => void loadInbox()} disabled={loading} aria-label="Refresh Gmail"><RefreshCw size={14} /></button>}
          {connected ? (
            <button type="button" className="gmail-connect-button is-connected" onClick={disconnectGmail}><CheckCircle2 size={14} /> Connected</button>
          ) : (
            <button type="button" className="gmail-connect-button" onClick={connectGmail} disabled={!scriptReady || !CLIENT_ID}>
              {scriptReady ? <Mail size={14} /> : <LoaderCircle size={14} className="gmail-spin" />}
              Connect Gmail
            </button>
          )}
        </div>
      </div>

      {!CLIENT_ID && <p className="gmail-setup-note">Setup required: add a Google OAuth web client ID to enable this integration.</p>}
      {loading && <div className="gmail-inbox-loading"><LoaderCircle size={16} className="gmail-spin" /> Checking for document attachments…</div>}
      {error && <div className="gmail-error" role="alert"><AlertCircle size={14} />{error}</div>}
      {!loading && connected && items.length === 0 && !error && (
        <div className="gmail-empty"><Paperclip size={17} /><span>No recent emails with attachments were found.</span></div>
      )}
      {!loading && items.length > 0 && (
        <div className="gmail-message-list">
          {items.map((mail) => (
            <article className="gmail-message" key={mail.id}>
              <div className="gmail-message-meta">
                <strong>{mail.subject}</strong>
                <span>{mail.from} {mail.date ? "· " + mail.date : ""}</span>
              </div>
              <div className="gmail-attachments">
                {mail.attachments.map((attachment) => {
                  const key = attachment.messageId + ":" + attachment.filename;
                  const pending = busyAttachment === key;
                  return (
                    <button type="button" className="gmail-attachment" key={key} onClick={() => void importAttachment(attachment)} disabled={Boolean(busyAttachment)}>
                      <FileText size={14} />
                      <span>{attachment.filename}</span>
                      {pending ? <LoaderCircle size={13} className="gmail-spin" /> : <Download size={13} />}
                    </button>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="gmail-inbox-footer">
        <span>{connected ? attachmentCount + " attachments found" : "Read-only access · your inbox is not changed"}</span>
        {connected && <button type="button" onClick={() => void loadInbox()} disabled={loading}>Refresh inbox</button>}
      </div>
    </section>
  );
}
