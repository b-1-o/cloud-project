"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mail,
  Paperclip,
  RefreshCw,
  Unplug,
} from "lucide-react";

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
      revoke: (token: string, callback?: () => void) => void;
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
  payload?: GmailPart & {
    headers?: Array<{ name: string; value: string }>;
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

type GmailDocumentLink = {
  url: string;
  label: string;
  provider: string;
};

type GmailMailItem = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  messageUrl: string;
  attachments: GmailAttachment[];
  links: GmailDocumentLink[];
};

type GmailListResponse = {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailProfile = {
  emailAddress?: string;
};

type Props = {
  onImportFile: (file: File) => Promise<void>;
};

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const PAGE_SIZE = 25;
const SEARCH_QUERY =
  'newer_than:180d -in:spam -in:trash {has:attachment "docs.google.com" "drive.google.com" "dropbox.com" "1drv.ms" "onedrive.live.com" "sharepoint.com" "box.com" "docusign.net" "acrobat.adobe.com" "notion.so"}';

const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "docm", "rtf", "odt", "pages",
  "xls", "xlsx", "xlsm", "ods", "numbers", "csv", "tsv",
  "ppt", "pptx", "pptm", "odp", "key",
  "txt", "md", "markdown", "html", "htm", "xml", "json",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "avif",
]);

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeBase64UrlText(value: string): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(decodeBase64Url(value));
}

function collectParts(root: GmailPart, visit: (part: GmailPart) => void): void {
  visit(root);
  root.parts?.forEach((part) => collectParts(part, visit));
}

function isDocumentAttachment(part: GmailPart): boolean {
  if (!part.filename?.trim()) return false;
  const extension = part.filename.split(".").pop()?.toLowerCase() || "";
  if (DOCUMENT_EXTENSIONS.has(extension)) return true;
  const mimeType = (part.mimeType || "").toLowerCase();
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType === "application/rtf" ||
    mimeType === "text/rtf" ||
    mimeType === "text/plain" ||
    mimeType === "text/csv" ||
    mimeType.startsWith("application/vnd.openxmlformats-officedocument.") ||
    mimeType.startsWith("application/vnd.oasis.opendocument.") ||
    mimeType.startsWith("application/vnd.ms-") ||
    mimeType.startsWith("image/")
  );
}

function collectAttachments(messageId: string, root?: GmailPart): GmailAttachment[] {
  if (!root) return [];
  const output: GmailAttachment[] = [];
  collectParts(root, (part) => {
    if (!isDocumentAttachment(part)) return;
    output.push({
      messageId,
      attachmentId: part.body?.attachmentId,
      inlineData: part.body?.data,
      filename: part.filename || "document",
      mimeType: part.mimeType || "application/octet-stream",
      size: part.body?.size,
    });
  });
  return output;
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  )?.value || "";
}

function collectMessageBodies(root?: GmailPart): { plain: string[]; html: string[] } {
  const bodies = { plain: [] as string[], html: [] as string[] };
  if (!root) return bodies;
  collectParts(root, (part) => {
    const encoded = part.body?.data;
    if (!encoded) return;
    const mimeType = (part.mimeType || "").toLowerCase();
    if (mimeType === "text/plain") bodies.plain.push(decodeBase64UrlText(encoded));
    if (mimeType === "text/html") bodies.html.push(decodeBase64UrlText(encoded));
  });
  return bodies;
}

function getDocumentProvider(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "docs.google.com") return "Google Docs";
  if (host === "drive.google.com") return "Google Drive";
  if (host === "dropbox.com" || host.endsWith(".dropbox.com")) return "Dropbox";
  if (host === "1drv.ms" || host === "onedrive.live.com") return "OneDrive";
  if (host.endsWith(".sharepoint.com")) return "SharePoint";
  if (host === "box.com" || host.endsWith(".box.com")) return "Box";
  if (host === "docusign.com" || host.endsWith(".docusign.net")) return "DocuSign";
  if (host === "acrobat.adobe.com") return "Adobe Acrobat";
  if (host === "notion.so" || host.endsWith(".notion.site")) return "Notion";
  return null;
}

function collectDocumentLinks(root?: GmailPart): GmailDocumentLink[] {
  const bodies = collectMessageBodies(root);
  const candidates: Array<{ url: string; label?: string }> = [];

  for (const html of bodies.html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("a[href]").forEach((anchor) => {
      candidates.push({
        url: anchor.getAttribute("href") || "",
        label: anchor.textContent?.trim() || undefined,
      });
    });
  }

  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  for (const plain of bodies.plain) {
    for (const match of plain.matchAll(urlPattern)) {
      candidates.push({ url: match[0].replace(/[.,;!?]+$/, "") });
    }
  }

  const unique = new Map<string, GmailDocumentLink>();
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.url);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const provider = getDocumentProvider(url);
      if (!provider) continue;
      const normalized = url.toString();
      if (!unique.has(normalized)) {
        unique.set(normalized, {
          url: normalized,
          label: (candidate.label || provider).slice(0, 120),
          provider,
        });
      }
    } catch {
      // Ignore malformed links from email bodies.
    }
  }
  return Array.from(unique.values()).slice(0, 8);
}

function formatMessageDate(message: GmailMessage): string {
  const timestamp = Number(message.internalDate || 0);
  if (timestamp > 0) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
  }
  const rawDate = header(message, "Date");
  const parsed = rawDate ? new Date(rawDate) : null;
  return parsed && Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed)
    : "";
}

function mergeUniqueMessages(
  existing: GmailMailItem[],
  incoming: GmailMailItem[],
): GmailMailItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

export function GmailInbox({ onImportFile }: Props) {
  const [accessToken, setAccessToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [items, setItems] = useState<GmailMailItem[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [nextPageToken, setNextPageToken] = useState("");
  const [resultEstimate, setResultEstimate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyAttachment, setBusyAttachment] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-identity="true"]'
    );
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
    if (!accessToken) throw new Error("Connect Gmail before loading documents.");
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
      { headers: { Authorization: "Bearer " + accessToken } }
    );
    if (!response.ok) {
      if (response.status === 401) {
        setAccessToken("");
        setConnected(false);
        setItems([]);
        setAccountEmail("");
        throw new Error("Gmail access expired. Connect the account again to refresh the inbox.");
      }
      const data = await response.json().catch(() => ({})) as {
        error?: { message?: string };
      };
      throw new Error(data.error?.message || "Gmail request failed (" + response.status + ").");
    }
    return response.json() as Promise<T>;
  }, [accessToken]);

  const loadInbox = useCallback(async (pageToken = "") => {
    if (!accessToken) return;
    if (pageToken) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const query = new URLSearchParams({
        q: SEARCH_QUERY,
        maxResults: String(PAGE_SIZE),
      });
      if (pageToken) query.set("pageToken", pageToken);

      const [list, profile] = await Promise.all([
        gmailFetch<GmailListResponse>("messages?" + query.toString()),
        pageToken
          ? Promise.resolve<GmailProfile | null>(null)
          : gmailFetch<GmailProfile>("profile"),
      ]);

      const records = await Promise.all((list.messages || []).map(async ({ id }) => {
        const message = await gmailFetch<GmailMessage>(
          "messages/" + encodeURIComponent(id) + "?format=full"
        );
        const attachments = collectAttachments(id, message.payload);
        const links = collectDocumentLinks(message.payload);
        if (attachments.length === 0 && links.length === 0) return null;

        return {
          id,
          from: header(message, "From") || "Unknown sender",
          subject: header(message, "Subject") || "No subject",
          date: formatMessageDate(message),
          snippet: (message.snippet || "").trim(),
          messageUrl: "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(id),
          attachments,
          links,
        } satisfies GmailMailItem;
      }));

      const relevant = records.filter((item): item is GmailMailItem => item !== null);
      setItems((current) => pageToken ? mergeUniqueMessages(current, relevant) : relevant);
      setNextPageToken(list.nextPageToken || "");
      setResultEstimate(Number(list.resultSizeEstimate || 0));
      if (profile?.emailAddress) setAccountEmail(profile.emailAddress);
      setConnected(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load document-related emails.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accessToken, gmailFetch]);

  useEffect(() => {
    if (accessToken) void loadInbox();
  }, [accessToken, loadInbox]);

  const attachmentCount = useMemo(
    () => items.reduce((total, mail) => total + mail.attachments.length, 0),
    [items]
  );
  const linkCount = useMemo(
    () => items.reduce((total, mail) => total + mail.links.length, 0),
    [items]
  );

  function connectGmail() {
    if (!CLIENT_ID) {
      setError("Gmail is not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID after creating a Google OAuth web client.");
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
      error_callback: (cause) => {
        setError(cause.message || "Google sign-in could not be opened.");
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  }

  function disconnectGmail() {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    setAccessToken("");
    setItems([]);
    setAccountEmail("");
    setNextPageToken("");
    setResultEstimate(0);
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
          "messages/" + encodeURIComponent(attachment.messageId) +
          "/attachments/" + encodeURIComponent(attachment.attachmentId)
        );
        if (!result.data) throw new Error("Gmail returned an empty attachment.");
        bytes = decodeBase64Url(result.data);
      } else if (attachment.inlineData) {
        bytes = decodeBase64Url(attachment.inlineData);
      } else {
        throw new Error("Gmail did not return attachment data.");
      }

      const fileBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(fileBuffer).set(bytes);
      const file = new File([fileBuffer], attachment.filename, {
        type: attachment.mimeType,
      });
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
          <span className="gmail-inbox-icon">
            <Mail size={17} strokeWidth={1.8} />
          </span>
          <div>
            <span className="eyebrow">INTEGRATIONS / GOOGLE MAIL</span>
            <h3 id="gmail-inbox-title">Documents from email</h3>
            <p>Find files and document links sent to your Gmail account.</p>
          </div>
        </div>
        <div className="gmail-inbox-actions">
          {connected && (
            <button
              type="button"
              className="gmail-icon-button"
              onClick={() => void loadInbox()}
              disabled={loading || loadingMore}
              aria-label="Refresh document emails"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          )}
          {connected ? (
            <button type="button" className="gmail-connect-button is-connected" onClick={disconnectGmail}>
              <Unplug size={14} /> Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="gmail-connect-button"
              onClick={connectGmail}
              disabled={!scriptReady || !CLIENT_ID}
            >
              {scriptReady ? <Mail size={14} /> : <LoaderCircle size={14} className="gmail-spin" />}
              Connect Gmail
            </button>
          )}
        </div>
      </div>

      {!CLIENT_ID && (
        <p className="gmail-setup-note">
          Setup required: add a Google OAuth web client ID to the frontend environment.
        </p>
      )}
      <p className="gmail-privacy-note">
        Read-only. CollabDocs searches recent messages for document files and trusted document links.
        Email content stays in this browser session; nothing is saved to CollabDocs until you import a file.
      </p>

      {connected && accountEmail && (
        <div className="gmail-account-label">
          <CheckCircle2 size={13} /> Connected as <strong>{accountEmail}</strong>
        </div>
      )}
      {loading && (
        <div className="gmail-inbox-loading">
          <LoaderCircle size={16} className="gmail-spin" /> Checking recent document-related emails…
        </div>
      )}
      {error && (
        <div className="gmail-error" role="alert"><AlertCircle size={14} />{error}</div>
      )}
      {!loading && connected && items.length === 0 && !error && (
        <div className="gmail-empty">
          <Paperclip size={17} /><span>No document files or supported document links found in the recent messages.</span>
        </div>
      )}
      {!loading && items.length > 0 && (
        <div className="gmail-message-list">
          {items.map((mail) => (
            <article className="gmail-message" key={mail.id}>
              <div className="gmail-message-heading-row">
                <div className="gmail-message-meta">
                  <strong title={mail.subject}>{mail.subject}</strong>
                  <span title={mail.from}>{mail.from}{mail.date ? " · " + mail.date : ""}</span>
                </div>
                <a
                  className="gmail-open-message"
                  href={mail.messageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open original email"
                  title="Open original email in Gmail"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
              {mail.snippet && <p className="gmail-message-snippet">{mail.snippet}</p>}
              {mail.attachments.length > 0 && (
                <div className="gmail-attachments">
                  {mail.attachments.map((attachment) => {
                    const key = attachment.messageId + ":" + attachment.filename;
                    const pending = busyAttachment === key;
                    return (
                      <button
                        type="button"
                        className="gmail-attachment"
                        key={key}
                        onClick={() => void importAttachment(attachment)}
                        disabled={Boolean(busyAttachment)}
                        title="Import this file into CollabDocs"
                      >
                        <FileText size={14} />
                        <span>{attachment.filename}</span>
                        {pending ? <LoaderCircle size={13} className="gmail-spin" /> : <Download size={13} />}
                      </button>
                    );
                  })}
                </div>
              )}
              {mail.links.length > 0 && (
                <div className="gmail-document-links">
                  {mail.links.map((link) => (
                    <a
                      className="gmail-document-link"
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={"Open " + link.provider}
                    >
                      <ExternalLink size={12} />
                      <span>{link.label}</span>
                      <small>{link.provider}</small>
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="gmail-inbox-footer">
        <span>
          {connected
            ? items.length + " emails · " + attachmentCount + " files · " + linkCount + " links" +
              (resultEstimate > 0 ? " · about " + resultEstimate + " matching messages" : "")
            : "Read-only access · your inbox is not changed"}
        </span>
        {connected && nextPageToken && (
          <button
            type="button"
            onClick={() => void loadInbox(nextPageToken)}
            disabled={loading || loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older emails"}
          </button>
        )}
      </div>
    </section>
  );
}
