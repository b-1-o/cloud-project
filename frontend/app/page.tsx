"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { clearAccessToken, completeOidcLogin, getAccessToken, startOidcLogin } from "@/lib/auth";
import { CollabEditor } from "@/components/collab-editor";
import { WorkspaceCalendar } from "@/components/workspace-calendar";
import { formatDistanceToNow } from "date-fns";
import { Toaster, toast } from "sonner";
import { CommandPalette, type CommandItem } from "@/components/command-palette";
import Folder from "@/components/react-bits/Folder";
import HoldButton from "@/components/HoldButton";
import { ArrowRight, ArrowUpRight, Check, Cloud, Code2, Command, FileText, LayoutTemplate, NotebookPen, Plus, Sparkles, Target, Users, Wifi, Clock3, Files, ShieldCheck, Star, Trash2, FolderOpen, Pencil, Inbox, MessageCircle, CalendarDays, ListChecks, BarChart3, Sun, Moon, Activity, Menu, Share2, X } from "lucide-react";

type DashboardFolder = "all" | "mine" | "shared" | "favorites";

type DocumentItem = {
  id: string;
  title: string;
  updated_at: string;
  workspace_name?: string;
  role?: string;
  local?: boolean;
};

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const LOCAL_DOCUMENTS_KEY = "collab-local-documents";
const LOCAL_TRASH_KEY = "collab-local-trash";

function readLocalDocuments(key = LOCAL_DOCUMENTS_KEY): DocumentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is DocumentItem => Boolean(item && item.local === true && typeof item.id === "string" && typeof item.title === "string"))
      : [];
  } catch {
    return [];
  }
}

function writeLocalDocuments(documents: DocumentItem[], key = LOCAL_DOCUMENTS_KEY): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(documents.filter((item) => item.local === true)));
  } catch {
    toast.error("Could not save the local document list. Check your browser storage.");
  }
}

function createLocalDocument(title: string): DocumentItem {
  return {
    id: "local-" + crypto.randomUUID(),
    title: title.trim().slice(0, 120) || "Untitled document",
    updated_at: new Date().toISOString(),
    workspace_name: "Personal workspace",
    role: "owner",
    local: true,
  };
}

const TEMPLATES: Array<{ id: string; title: string }> = [
  { id: "blank", title: "Untitled document" },
  { id: "meeting", title: "Meeting notes" },
  { id: "brief", title: "Project brief" },
  { id: "spec", title: "Tech spec" },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  const token = await getAccessToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(API + path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) {
      throw new Error("Authentication required. Please sign in to continue.");
    }
    throw new Error(body.error || "Request failed (" + response.status + ")");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
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
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"updated" | "name">("updated");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: DocumentItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [emptyTrashConfirm, setEmptyTrashConfirm] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"trash" | "permanent">("trash");
  const [deleting, setDeleting] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReveal, setThemeReveal] = useState<{ x: number; y: number; tone: "light" | "dark" } | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [publicLink, setPublicLink] = useState("");
  const [publicBusy, setPublicBusy] = useState(false);
  const [viewMode, setViewMode] = useState<"docs" | "trash">("docs");
  const [filter, setFilter] = useState<"all" | "mine" | "shared">("all");
  const [dashboardFolder, setDashboardFolder] = useState<DashboardFolder>("all");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [openCommentsForId, setOpenCommentsForId] = useState<string | null>(null);
  const [sheetTransitionId, setSheetTransitionId] = useState<string | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const themeTransitionTimerRef = useRef<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingDocId = useRef<string | null>(null);
  const pendingRestore = useRef<{ id: string; title: string } | null>(null);
  const authInitializationRef = useRef(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("doc");
    if (fromUrl) pendingDocId.current = fromUrl;
    try {
      const fav = JSON.parse(localStorage.getItem("collab-favorites") || "[]");
      if (Array.isArray(fav)) setFavorites(fav.filter((x) => typeof x === "string"));
    } catch { /* ignore */ }
    const stored = localStorage.getItem("collab-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("collab-favorites", JSON.stringify(next));
      return next;
    });
  }

  async function ensurePublicLink() {
    if (!active) return;
    if (!signedIn || active.local) {
      toast.info("Sign in to create public links.");
      return;
    }
    setPublicBusy(true);
    try {
      const result = await request<{ publicUrl: string; token: string }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/public-link",
        { method: "POST" }
      );
      const url = result.publicUrl.startsWith("http") ? result.publicUrl : window.location.origin + result.publicUrl;
      setPublicLink(url);
      await navigator.clipboard.writeText(url);
      toast.success("Public view link copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create public link");
    } finally {
      setPublicBusy(false);
    }
  }

  function toggleTheme(event?: React.MouseEvent<HTMLButtonElement>) {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (themeTransitionTimerRef.current !== null) {
      window.clearTimeout(themeTransitionTimerRef.current);
      themeTransitionTimerRef.current = null;
    }
    if (!reduceMotion) {
      const rect = event?.currentTarget.getBoundingClientRect();
      setThemeReveal({
        x: rect ? rect.left + rect.width / 2 : window.innerWidth - 40,
        y: rect ? rect.top + rect.height / 2 : 36,
        tone: next,
      });
      root.classList.add("theme-color-transition");
    } else {
      setThemeReveal(null);
    }
    setTheme(next);
    localStorage.setItem("collab-theme", next);
    root.classList.toggle("dark", next === "dark");

    themeTransitionTimerRef.current = window.setTimeout(() => {
      root.classList.remove("theme-color-transition");
      setThemeReveal(null);
      themeTransitionTimerRef.current = null;
    }, reduceMotion ? 0 : 620);
  }

  const refresh = useCallback(async (mode?: "docs" | "trash", allowRemote = signedIn) => {
    const nextMode = mode || viewMode;
    const localKey = nextMode === "trash" ? LOCAL_TRASH_KEY : LOCAL_DOCUMENTS_KEY;
    try {
      const localDocuments = readLocalDocuments(localKey);
      if (!allowRemote) {
        setDocuments(localDocuments);
        if (nextMode === "docs") {
          const targetId = pendingDocId.current || new URLSearchParams(window.location.search).get("doc");
          const found = targetId ? localDocuments.find((document) => document.id === targetId) : undefined;
          if (found) setActive(found);
        }
        setError("");
        return;
      }

      const path = nextMode === "trash" ? "/api/documents/trash" : "/api/documents?filter=all";
      const result = await request<{ documents: DocumentItem[] }>(path);
      const remoteDocuments = Array.isArray(result.documents) ? result.documents : [];
      const merged = [
        ...localDocuments,
        ...remoteDocuments.filter((remote) => !localDocuments.some((local) => local.id === remote.id)),
      ];
      setDocuments(merged);
      if (nextMode === "docs") {
        const targetId = pendingDocId.current || new URLSearchParams(window.location.search).get("doc");
        if (targetId) {
          const found = merged.find((document) => document.id === targetId);
          if (found) {
            pendingDocId.current = targetId;
            setActive(found);
          } else {
            const one = await request<{ document: DocumentItem }>("/api/documents/" + encodeURIComponent(targetId)).catch(() => null);
            if (one?.document) {
              pendingDocId.current = targetId;
              setActive(one.document);
            }
          }
        }
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [viewMode, signedIn]);

  useEffect(() => {
    if (authInitializationRef.current) return;
    authInitializationRef.current = true;
    async function finishSignIn() {
      try {
        const completed = await completeOidcLogin(new URL(window.location.href));
        const hasToken = completed || Boolean(await getAccessToken());
        setSignedIn(hasToken);
        await refresh("docs", hasToken);
      } catch (err) {
        setSignedIn(false);
        setError(err instanceof Error ? err.message : "Sign-in failed");
        await refresh("docs", false);
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

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK" && !e.isComposing) {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setDeleteTarget(null);
        setShareOpen(false);
        setEmptyTrashConfirm(false);
        setCmdOpen(false);
        setTemplateOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = documents;
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q));
    if (sortBy === "name") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else list = [...list].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return list;
  }, [documents, search, sortBy]);

  const navigatedDocuments = useMemo(() => {
    if (viewMode === "trash") return filtered;
    if (filter === "mine") return filtered.filter((doc) => doc.local || doc.role === "owner");
    if (filter === "shared") return filtered.filter((doc) => !doc.local && Boolean(doc.role) && doc.role !== "owner");
    return filtered;
  }, [filtered, filter, viewMode]);

  const sidebarDocuments = viewMode === "trash" ? filtered : navigatedDocuments;


  function chooseDashboardFolder(folder: DashboardFolder) {
    setDashboardFolder(folder);
    setViewMode("docs");
    setActive(null);
    setOpenCommentsForId(null);
    setFilter(folder === "mine" || folder === "shared" ? folder : "all");
    void refresh("docs");
  }

  useEffect(() => {
    const targetId = pendingDocId.current || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("doc") : null);
    if (!targetId || documents.length === 0 || viewMode === "trash") return;
    const found = documents.find((d) => d.id === targetId);
    if (found && active?.id !== found.id) {
      pendingDocId.current = targetId;
      setActive(found);
    }
  }, [documents, active?.id, viewMode]);

  async function signIn() {
    try { await startOidcLogin(); } catch (err) { setError(err instanceof Error ? err.message : "Could not start sign-in"); }
  }

  async function signOut() {
    pendingDocId.current = null;
    setSignedIn(false); setActive(null); setDocuments(readLocalDocuments()); setError("");
    window.history.replaceState({}, "", window.location.pathname);
    await clearAccessToken();
  }

  async function shareDocument() {
    if (!active) return;
    if (!signedIn || active.local) {
      toast.info("Sign in to share documents and use collaboration tools.");
      return;
    }
    setSharing(true); setShareMessage("");
    try {
      const result = await request<{ member: { email: string; role: string } }>(
        "/api/documents/" + encodeURIComponent(active.id) + "/members",
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }) }
      );
      setShareMessage("Access granted to " + result.member.email + " as " + result.member.role + ".");
      setInviteEmail("");
      toast.success("Shared with " + result.member.email);
    } catch (err) {
      setShareMessage(err instanceof Error ? err.message : "Could not share document");
    } finally { setSharing(false); }
  }

  async function copyDocumentLink() {
    if (!active) return;
    if (!signedIn || active.local) {
      toast.info("Sign in to share a document link.");
      return;
    }
    try {
      const link = new URL("/", window.location.origin);
      link.searchParams.set("doc", active.id);
      await navigator.clipboard.writeText(link.toString());
      setShareMessage("App link copied.");
      toast.success("Link copied");
    } catch { setShareMessage("Copy failed."); }
  }

  async function duplicateDocument(doc: DocumentItem) {
    if (!signedIn || doc.local) {
      toast.info("Sign in to use workspace duplication.");
      return;
    }
    try {
      const result = await request<{ document: DocumentItem }>(
        "/api/documents/" + encodeURIComponent(doc.id) + "/duplicate",
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      setViewMode("docs");
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document);
      setContextMenu(null);
      toast.success("Document duplicated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not duplicate");
    }
  }

  async function restoreDocument(doc: DocumentItem) {
    try {
      if (doc.local) {
        const trash = readLocalDocuments(LOCAL_TRASH_KEY).filter((item) => item.id !== doc.id);
        const current = readLocalDocuments(LOCAL_DOCUMENTS_KEY);
        writeLocalDocuments(trash, LOCAL_TRASH_KEY);
        writeLocalDocuments([doc, ...current.filter((item) => item.id !== doc.id)], LOCAL_DOCUMENTS_KEY);
        toast.success("Document restored");
        setViewMode("docs");
        await refresh("docs");
        return;
      }
      await request("/api/documents/" + encodeURIComponent(doc.id) + "/restore", { method: "POST" });
      toast.success("Document restored");
      setViewMode("docs");
      await refresh("docs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore");
    }
  }

  async function emptyTrashNow() {
    setDeleting(true);
    try {
      let remoteDeleted = 0;
      if (signedIn) {
        const result = await request<{ deleted: number }>("/api/documents/trash", { method: "DELETE" });
        remoteDeleted = Number(result.deleted) || 0;
      }
      const localTrash = readLocalDocuments(LOCAL_TRASH_KEY);
      const locallyDeleted = localTrash.length;
      writeLocalDocuments([], LOCAL_TRASH_KEY);
      setDocuments((current) => current.filter((doc) => !doc.local && doc.role !== "owner"));
      setEmptyTrashConfirm(false);
      toast.success("Trash emptied", { description: (remoteDeleted + locallyDeleted) + " document(s) permanently deleted." });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not empty trash");
    } finally {
      setDeleting(false);
    }
  }

  async function hardDeleteDocument(doc: DocumentItem) {
    setDeleting(true);
    try {
      if (doc.local) {
        writeLocalDocuments(readLocalDocuments(LOCAL_TRASH_KEY).filter((item) => item.id !== doc.id), LOCAL_TRASH_KEY);
        setDocuments((list) => list.filter((item) => item.id !== doc.id));
        setDeleteTarget(null);
        setDeleteMode("trash");
        toast.success("Permanently deleted");
        return;
      }
      await request("/api/documents/" + encodeURIComponent(doc.id) + "/hard", {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      if (active?.id === doc.id) {
        pendingDocId.current = null;
        setActive(null);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setDeleteTarget(null);
      setDeleteMode("trash");
      toast.success("Permanently deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete forever");
    } finally {
      setDeleting(false);
    }
  }

  async function createFromTemplate(title: string) {
    setCreating(true);
    setTemplateOpen(false);
    try {
      if (!signedIn) {
        const document = createLocalDocument(title);
        writeLocalDocuments([document, ...readLocalDocuments()]);
        setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
        pendingDocId.current = document.id;
        setViewMode("docs");
        setFilter("all");
        setDashboardFolder("all");
        setActive(document);
        setError("");
        toast.success("Saved on this device");
        return;
      }
      const result = await request<{ document: DocumentItem }>("/api/documents", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title }),
      });
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document);
      toast.success("Created from template");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setCreating(false);
    }
  }

  async function createDocument() {
    setCreating(true);
    try {
      if (!signedIn) {
        const document = createLocalDocument("Untitled document");
        writeLocalDocuments([document, ...readLocalDocuments()]);
        setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
        pendingDocId.current = document.id;
        setViewMode("docs");
        setFilter("all");
        setDashboardFolder("all");
        setActive(document);
        setError("");
        setSidebarOpen(false);
        toast.success("Saved on this device");
        return;
      }
      const result = await request<{ document: DocumentItem }>("/api/documents", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: "Untitled document" }),
      });
      setDocuments((current) => [result.document, ...current]);
      pendingDocId.current = result.document.id;
      setActive(result.document); setError(""); setSidebarOpen(false);
      toast.success("Document created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document");
      toast.error("Failed to create document");
    } finally { setCreating(false); }
  }

  async function deleteDocument(doc: DocumentItem) {
    setDeleting(true);
    try {
      if (doc.local) {
        const remaining = readLocalDocuments(LOCAL_DOCUMENTS_KEY).filter((item) => item.id !== doc.id);
        const trash = readLocalDocuments(LOCAL_TRASH_KEY);
        writeLocalDocuments(remaining, LOCAL_DOCUMENTS_KEY);
        writeLocalDocuments([{ ...doc, updated_at: new Date().toISOString() }, ...trash], LOCAL_TRASH_KEY);
        setDocuments((list) => list.filter((item) => item.id !== doc.id));
        if (active?.id === doc.id) {
          pendingDocId.current = null;
          setActive(null);
          window.history.replaceState({}, "", window.location.pathname);
        }
        setDeleteTarget(null);
        setDeleteMode("trash");
        toast.success("Moved to local trash");
        return;
      }
      await request("/api/documents/" + encodeURIComponent(doc.id), { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } });
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      if (active?.id === doc.id) {
        pendingDocId.current = null;
        setActive(null);
        window.history.replaceState({}, "", window.location.pathname);
      }
      setDeleteTarget(null); setDeleteMode("trash");
      pendingRestore.current = { id: doc.id, title: doc.title };
      toast.success("Moved to trash", {
        description: "Undo within 8 seconds",
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            const target = pendingRestore.current;
            if (!target) return;
            void request("/api/documents/" + encodeURIComponent(target.id) + "/restore", { method: "POST" })
              .then(() => { toast.success("Restored"); void refresh("docs"); })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Could not undo"));
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete document");
    } finally { setDeleting(false); }
  }

  async function renameDocument(doc: DocumentItem, title: string) {
    const next = title.trim().slice(0, 120) || "Untitled document";
    setRenamingId(null);
    if (next === doc.title) return;
    setDocuments((list) => list.map((d) => (d.id === doc.id ? { ...d, title: next, updated_at: new Date().toISOString() } : d)));
    if (active?.id === doc.id) setActive((a) => (a ? { ...a, title: next } : a));
    if (doc.local) {
      const key = viewMode === "trash" ? LOCAL_TRASH_KEY : LOCAL_DOCUMENTS_KEY;
      writeLocalDocuments(readLocalDocuments(key).map((item) => item.id === doc.id ? { ...item, title: next, updated_at: new Date().toISOString() } : item), key);
      toast.success("Renamed");
      return;
    }
    try {
      await request("/api/documents/" + encodeURIComponent(doc.id), {
        method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: next }),
      });
      toast.success("Renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
      void refresh();
    }
  }

  function openContextMenu(e: React.MouseEvent, doc: DocumentItem) {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  }

  function startRename(doc: DocumentItem) {
    setContextMenu(null); setRenamingId(doc.id); setRenameValue(doc.title);
  }

  const isFirstRunEmpty = !loading && viewMode === "docs" && filter === "all" && !search.trim() && documents.length === 0;

  const commandItems: CommandItem[] = [
    { id: "new", label: "New document", hint: "Create blank", run: () => void createDocument() },
    { id: "template", label: "New from template…", run: () => setTemplateOpen(true) },
    { id: "home", label: "Go to home", run: () => { pendingDocId.current = null; setActive(null); } },
    { id: "trash", label: "Open trash", run: () => { setViewMode("trash"); setActive(null); void refresh("trash"); } },
    { id: "theme", label: "Toggle theme", run: () => toggleTheme() },
    ...documents.slice(0, 12).map((d) => ({
      id: "doc-" + d.id,
      label: d.title,
      hint: "Open",
      run: () => { pendingDocId.current = d.id; setActive(d); setViewMode("docs"); },
    })),
  ];


  const ownedDocumentCount = documents.filter((doc) => doc.role === "owner").length;
  const sharedDocumentCount = documents.filter((doc) => Boolean(doc.role) && doc.role !== "owner").length;
  const favoriteDocumentCount = favorites.filter((id) => documents.some((doc) => doc.id === id)).length;
  const activeFolderLabel =
    dashboardFolder === "mine" ? "Owned by you" :
    dashboardFolder === "shared" ? "Shared with you" :
    dashboardFolder === "favorites" ? "Favorites" : "Recent documents";
  const folderColor = theme === "dark" ? "#d29aab" : "#713046";
  const workspaceView = viewMode === "trash" ? "trash" : filter === "mine" ? "mine" : filter === "shared" ? "shared" : dashboardFolder === "favorites" ? "favorites" : "all";
  const collectionFolders = useMemo(() => {
    const makeItems = (list: DocumentItem[]) =>
      list.slice(0, 6).map((doc) => ({
        id: doc.id,
        title: doc.title,
        description: doc.title,
      }));
    const mine = filtered.filter((doc) => doc.role === "owner");
    const shared = filtered.filter((doc) => Boolean(doc.role) && doc.role !== "owner");
    const saved = filtered.filter((doc) => favorites.includes(doc.id));

    return [
      { id: "all" as const, label: "All documents", description: "Everything in your library", count: documents.length, color: folderColor, items: makeItems(filtered) },
      { id: "mine" as const, label: "Owned by you", description: "Documents you manage", count: ownedDocumentCount, color: folderColor, items: makeItems(mine) },
      { id: "shared" as const, label: "Shared with you", description: "Work with your team", count: sharedDocumentCount, color: folderColor, items: makeItems(shared) },
      { id: "favorites" as const, label: "Favorites", description: "Your saved documents", count: favoriteDocumentCount, color: folderColor, items: makeItems(saved) },
    ];
  }, [documents, filtered, favorites, ownedDocumentCount, sharedDocumentCount, favoriteDocumentCount, folderColor]);

  function openCommentsHub() {
    if (!signedIn) {
      toast.info("Sign in to use workspace comments.");
      return;
    }
    const target = filtered[0] ?? documents[0];
    if (!target) {
      toast.info("Create a document first to start a comment thread.");
      return;
    }
    setOpenCommentsForId(target.id);
    pendingDocId.current = target.id;
    setActive(target);
    setViewMode("docs");
    setFilter("all");
    setDashboardFolder("all");
    setSidebarOpen(false);
  }

  const openDocument = useCallback((doc: DocumentItem, comments = false, viaSheet = false) => {
    setOpenCommentsForId(comments ? doc.id : null);
    setSheetTransitionId(viaSheet ? doc.id : null);
    pendingDocId.current = doc.id;
    setActive(doc);
    setViewMode("docs");
    setFilter("all");
    setDashboardFolder("all");
    setSidebarOpen(false);
  }, []);

  const handleSmartFolderItemClick = useCallback((item: unknown) => {
    const itemId = (item as { id?: string } | null)?.id;
    if (!itemId) return;
    const selected = documents.find((doc) => doc.id === itemId);
    if (!selected) return;

    const source = Array.from(document.querySelectorAll<HTMLElement>("[data-folder-document-id]"))
      .find((element) => element.dataset.folderDocumentId === selected.id);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (!source || reduceMotion || !transitionDocument.startViewTransition) {
      openDocument(selected);
      return;
    }

    source.style.setProperty("view-transition-name", "collab-document-sheet");
    const clearSourceName = () => source.style.removeProperty("view-transition-name");
    try {
      const transition = transitionDocument.startViewTransition(() => {
        flushSync(() => openDocument(selected, false, true));
        const mainPanel = document.querySelector<HTMLElement>(".main-panel");
        if (mainPanel) {
          mainPanel.scrollTop = 0;
          mainPanel.scrollLeft = 0;
        }
        const paperWrap = document.querySelector<HTMLElement>(".paper-wrap");
        if (paperWrap) {
          paperWrap.scrollTop = 0;
          paperWrap.scrollLeft = 0;
        }
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
      void transition.finished.then(() => {
        clearSourceName();
        setSheetTransitionId((id) => id === selected.id ? null : id);
      }, () => {
        clearSourceName();
        setSheetTransitionId((id) => id === selected.id ? null : id);
      });
    } catch {
      clearSourceName();
      openDocument(selected);
    }
  }, [documents, openDocument]);

  return (
    <main className="shell">
      <Toaster position="bottom-right" richColors closeButton />
      {themeReveal && <div className={"theme-reveal theme-reveal-" + themeReveal.tone} style={{ "--theme-x": themeReveal.x + "px", "--theme-y": themeReveal.y + "px" } as CSSProperties} aria-hidden="true" />}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden />}
      <aside className={"sidebar" + (sidebarOpen ? " sidebar-open" : "")}>
        <a className="brand" href="/" aria-label="Collab Docs home" onClick={() => { pendingDocId.current = null; setActive(null); window.scrollTo({ top: 0, behavior: "auto" }); }}>
          <span className="brand-mark">C</span><span>collab<span className="brand-light">docs</span></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <div className="workspace-pill"><span className="workspace-dot" /> Personal workspace</div>
        <div className="search-wrap"><input className="search-input" type="search" placeholder="Search documents…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search documents" /></div>
        <div className="sort-row">
          <button type="button" className={sortBy === "updated" ? "sort-btn active" : "sort-btn"} onClick={() => setSortBy("updated")}>Recent</button>
          <button type="button" className={sortBy === "name" ? "sort-btn active" : "sort-btn"} onClick={() => setSortBy("name")}>Name</button>
        </div>
        <div className="sort-row filter-row workspace-nav" aria-label="Document views">
          <button type="button" aria-current={filter === "all" && viewMode === "docs" ? "page" : undefined} className={filter === "all" && viewMode === "docs" ? "sort-btn workspace-route-button active" : "sort-btn workspace-route-button"} onClick={() => chooseDashboardFolder("all")}><Files size={13} aria-hidden="true" /><span>All</span></button>
          <button type="button" aria-current={filter === "mine" && viewMode === "docs" ? "page" : undefined} className={filter === "mine" && viewMode === "docs" ? "sort-btn workspace-route-button active" : "sort-btn workspace-route-button"} onClick={() => chooseDashboardFolder("mine")}><ShieldCheck size={13} aria-hidden="true" /><span>Mine</span></button>
          <button type="button" aria-current={filter === "shared" && viewMode === "docs" ? "page" : undefined} className={filter === "shared" && viewMode === "docs" ? "sort-btn workspace-route-button active" : "sort-btn workspace-route-button"} onClick={() => chooseDashboardFolder("shared")}><Users size={13} aria-hidden="true" /><span>Shared</span></button>
          <button type="button" aria-current={viewMode === "trash" ? "page" : undefined} className={viewMode === "trash" ? "sort-btn workspace-route-button active" : "sort-btn workspace-route-button"} onClick={() => { setViewMode("trash"); setActive(null); setFilter("all"); setOpenCommentsForId(null); void refresh("trash"); }}><Trash2 size={13} aria-hidden="true" /><span>Trash</span></button>
        </div>
        <div className="sidebar-label docs-label">{viewMode === "trash" ? "TRASH" : "YOUR DOCUMENTS"}</div>
        <button className="new-doc" onClick={createDocument} disabled={creating || viewMode === "trash"}><span>＋</span> New document</button>
        <button type="button" className="templates-launch" onClick={() => setTemplateOpen(true)} disabled={creating || viewMode === "trash"}>
          <span className="templates-launch-icon" aria-hidden="true"><LayoutTemplate size={17} strokeWidth={1.8} /></span>
          <span className="templates-launch-copy"><strong>Templates</strong><small>Start with a structure</small></span>
          <span className="templates-launch-trailing"><span>04</span><ArrowUpRight size={14} /></span>
        </button>
        <div className="document-list" role="list">
          {loading && (<><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></>)}
          {!loading && sidebarDocuments.map((doc) => (
            <div key={doc.id} className={"document-item" + (active?.id === doc.id ? " selected" : "")} role="listitem">
              {renamingId === doc.id ? (
                <input ref={renameInputRef} className="inline-rename" value={renameValue} maxLength={120} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => void renameDocument(doc, renameValue)} onKeyDown={(e) => { if (e.key === "Enter") void renameDocument(doc, renameValue); if (e.key === "Escape") setRenamingId(null); }} aria-label="Rename document" />
              ) : (
                <button type="button" className="document-link" onClick={() => openDocument(doc)} onDoubleClick={() => startRename(doc)} onContextMenu={(e) => openContextMenu(e, doc)}>
                  <span className="doc-symbol" aria-hidden>▤</span>
                  <span className="doc-meta"><span className="doc-title">{doc.title}</span><span className="doc-date">{relativeTime(doc.updated_at)}</span></span>
                  {doc.role === "viewer" && <span className="role-badge">View</span>}
                </button>
              )}
              <button type="button" className="fav-star" aria-label="Toggle favorite" onClick={(e) => { e.stopPropagation(); toggleFavorite(doc.id); }}>{favorites.includes(doc.id) ? <Star size={13} fill="currentColor" /> : <Star size={13} />}</button>
              <button type="button" className="doc-more" aria-label="Document actions" onClick={(e) => openContextMenu(e, doc)}>···</button>
            </div>
          ))}
          {!loading && sidebarDocuments.length === 0 && search && <div className="list-placeholder">No documents match “{search}”</div>}
          {!loading && sidebarDocuments.length === 0 && !search && (
            <div className="list-placeholder sidebar-empty-note">
              {viewMode === "trash" ? "Trash is empty." : filter === "mine" ? "No owned documents." : filter === "shared" ? "Nothing shared with you." : "No documents yet."}
            </div>
          )}
        </div>
        <div className="sidebar-bottom"><span className="avatar">B</span><div><strong>{signedIn ? "Signed-in account" : "Local workspace"}</strong><small>{signedIn ? "Authenticated session" : "Development session"}</small></div></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="menu-toggle" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((o) => !o)}><Menu size={17} strokeWidth={1.8} /></button>
            <div className="breadcrumbs"><button type="button" className="breadcrumb-home" onClick={() => chooseDashboardFolder("all")}>Personal workspace</button><span className="slash">/</span><strong>{active?.title || (viewMode === "trash" ? "Trash" : "Home")}</strong></div>
          </div>
          <nav className="breadcrumb-quick-nav" aria-label="Quick workspace navigation">
            <button type="button" className={viewMode === "docs" && filter === "all" ? "active" : ""} onClick={() => chooseDashboardFolder("all")}>All</button>
            <button type="button" className={viewMode === "docs" && filter === "mine" ? "active" : ""} onClick={() => chooseDashboardFolder("mine")}>Mine</button>
            <button type="button" className={viewMode === "docs" && filter === "shared" ? "active" : ""} onClick={() => chooseDashboardFolder("shared")}>Shared</button>
            <button type="button" className={viewMode === "trash" ? "active" : ""} onClick={() => { setViewMode("trash"); setActive(null); setFilter("all"); setOpenCommentsForId(null); void refresh("trash"); }}>Trash</button>
          </nav>
          <div className="top-actions">
            <button type="button" className="theme-toggle" data-theme={theme} onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}><span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}</span></button>
            <span className="secure-label"><span className={signedIn ? "green-dot" : "local-dot"} /> {signedIn ? "Autosave enabled" : "Saved on this device"}</span>
            <button className="share-button" onClick={() => { if (!signedIn || active?.local) { toast.info("Sign in to unlock sharing and collaboration."); return; } setShareMessage(""); setPublicLink(""); setShareOpen(true); }} disabled={!active || active.role !== "owner" || active.local}><Share2 size={14} /> Share</button>
            {process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL && (signedIn ? <button className="auth-button" onClick={signOut}>Sign out</button> : <button className="auth-button" onClick={signIn}>Sign in</button>)}
            <span className="avatar small-avatar">B</span>
          </div>
        </header>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
        {active ? (
          <CollabEditor key={active.id} documentId={active.id} initialTitle={active.title} apiBase={API} localOnly={active.local === true} readOnly={active.role === "viewer"} openingFromSheet={sheetTransitionId === active.id} openCommentsOnMount={openCommentsForId === active.id && signedIn && active.local !== true} onTitleChange={(title) => {
            setDocuments((list) => list.map((d) => (d.id === active.id ? { ...d, title } : d)));
            if (active.local) {
              const key = viewMode === "trash" ? LOCAL_TRASH_KEY : LOCAL_DOCUMENTS_KEY;
              writeLocalDocuments(readLocalDocuments(key).map((item) => item.id === active.id ? { ...item, title, updated_at: new Date().toISOString() } : item), key);
            }
          }} onDeleteRequest={() => { setDeleteTarget(active); setDeleteMode("trash"); }} />
        ) : loading ? (
          <div className="dashboard"><div className="skeleton-row" style={{ maxWidth: 320, margin: "48px auto" }} /><div className="skeleton-row" style={{ maxWidth: 480, margin: "12px auto" }} /></div>
        ) : viewMode === "trash" ? (
          <div className="trash-workspace page-transition" data-view="trash">
            <header className="trash-page-hero">
              <div className="trash-page-symbol"><Trash2 size={21} strokeWidth={1.6} /></div>
              <div className="trash-page-heading">
                <div className="eyebrow">WORKSPACE / TRASH</div>
                <h1>Recently deleted<span>.</span></h1>
                <p>Restore something you still need, or remove it permanently.</p>
              </div>
              <span className="trash-page-count">{filtered.length.toString().padStart(2, "0")} <small>ITEMS</small></span>
              {filtered.length > 0 && <button type="button" className="empty-trash-button" onClick={() => setEmptyTrashConfirm(true)} disabled={deleting}><Trash2 size={14} /> Empty trash</button>}
            </header>
            {filtered.length === 0 ? (
              <div className="trash-empty-panel">
                <span className="trash-empty-icon"><Trash2 size={23} strokeWidth={1.5} /></span>
                <h2>{search.trim() ? "No matches in Trash" : "Your Trash is empty"}</h2>
                <p>{search.trim() ? "Try a different document title." : "Deleted documents will appear here. Nothing to clean up right now."}</p>
                {search.trim() && <button type="button" className="secondary-button" onClick={() => setSearch("")}>Clear search</button>}
              </div>
            ) : (
              <div className="trash-document-grid">
                {filtered.map((doc) => (
                  <article className="trash-document-card" key={doc.id}>
                    <div className="trash-document-icon"><FileText size={19} strokeWidth={1.65} /></div>
                    <div className="trash-document-copy">
                      <strong title={doc.title}>{doc.title}</strong>
                      <span>Deleted {relativeTime(doc.updated_at)}</span>
                    </div>
                    <div className="trash-document-actions">
                      <button type="button" className="trash-restore-button" onClick={() => void restoreDocument(doc)}><ArrowRight size={14} /><span>Restore</span></button>
                      <button type="button" className="trash-delete-button" aria-label={"Delete " + doc.title + " forever"} onClick={() => { setDeleteTarget(doc); setDeleteMode("permanent"); }} disabled={doc.role !== "owner"}><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : isFirstRunEmpty ? (
          <div className="workspace-home">
            <div className="home-overline">
              <span className="home-overline-mark"><Sparkles size={13} strokeWidth={1.8} /></span>
              <span>A QUIETER SPACE FOR BIG IDEAS</span>
              <span className="home-overline-rule" />
            </div>

            <section className="workspace-hero">
              <div className="workspace-intro">
                <h1 className="workspace-title">Make room for<br /><em>good ideas.</em></h1>
                <p className="workspace-lead">
                  A calm place to think, write, and work things out together. Start with a blank page or give your idea a little structure.
                </p>
                <div className="workspace-actions">
                  <button className="primary-button workspace-cta" onClick={createDocument} disabled={creating}>
                    <Plus size={16} strokeWidth={2.1} />
                    <span>{creating ? "Creating…" : "Create document"}</span>
                    <ArrowRight size={15} strokeWidth={1.9} />
                  </button>
                  <button type="button" className="secondary-button workspace-template-cta" onClick={() => setTemplateOpen(true)} disabled={creating}>
                    <LayoutTemplate size={15} strokeWidth={1.8} />
                    <span>Browse templates</span>
                  </button>
                </div>
                <div className="feature-row workspace-feature-row">
                  <span className="feature-item"><Users size={14} strokeWidth={1.8} /> Built for collaboration</span>
                  <span className="feature-item"><Wifi size={14} strokeWidth={1.8} /> Works offline</span>
                </div>
              </div>

              <div className="preview-stage" aria-hidden="true">
                <div className="preview-stage-glow" />
                <div className="editor-preview">
                  <div className="preview-chrome">
                    <div className="preview-document-label">
                      <span className="preview-document-icon"><FileText size={15} strokeWidth={1.8} /></span>
                      <span className="preview-document-copy">
                        <strong>Untitled document</strong>
                        <small>PERSONAL WORKSPACE</small>
                      </span>
                    </div>
                    <div className="preview-window-actions"><span /><span /><span /></div>
                  </div>
                  <div className="preview-toolbar">
                    <span className="preview-format">Aa</span>
                    <span className="preview-tool preview-tool-heading" />
                    <span className="preview-toolbar-divider" />
                    <span className="preview-tool" />
                    <span className="preview-tool preview-tool-short" />
                    <span className="preview-tool" />
                    <span className="preview-toolbar-spacer" />
                    <span className="preview-toolbar-dot" />
                  </div>
                  <div className="preview-paper">
                    <div className="preview-paper-meta">
                      <span>NEW DOCUMENT</span>
                      <span>START ANYWHERE</span>
                    </div>
                    <h3>Start with a thought.<br /><em>See where it goes.</em></h3>
                    <p>A quiet place to collect ideas, shape plans, and build something together.</p>
                    <div className="preview-writing-lines">
                      <span className="line-long" />
                      <span />
                      <span className="line-medium" />
                    </div>
                    <div className="preview-paper-footer">
                      <span><i /> Ready when you are</span>
                      <span>01 / 01</span>
                    </div>
                  </div>
                </div>
                <div className="preview-float-note">
                  <span className="preview-float-icon"><Check size={14} strokeWidth={2.1} /></span>
                  <span><strong>Room to focus</strong><small>Everything starts somewhere</small></span>
                </div>
              </div>
            </section>

            <section className="quick-start">
              <div className="quick-start-header">
                <div>
                  <div className="eyebrow">A GOOD PLACE TO BEGIN</div>
                  <h2>Choose your starting point.</h2>
                </div>
                <p>Keep it simple, or start with a little structure.</p>
              </div>
              <div className="template-grid quick-start-grid">
                {TEMPLATES.map((tpl) => {
                  const TemplateIcon = tpl.id === "blank" ? FileText : tpl.id === "meeting" ? NotebookPen : tpl.id === "brief" ? Target : Code2;
                  const description = tpl.id === "blank" ? "A clean page for whatever is on your mind" : tpl.id === "meeting" ? "Agenda, notes, decisions, and next steps" : tpl.id === "brief" ? "Goals, scope, and milestones in one place" : "Organize technical details and decisions";
                  return (
                    <button key={tpl.id} type="button" className="template-card" onClick={() => void createFromTemplate(tpl.title)} disabled={creating}>
                      <span className="template-icon"><TemplateIcon size={18} strokeWidth={1.7} /></span>
                      <span className="template-body">
                        <span className="template-title">{tpl.title}</span>
                        <span className="template-desc">{description}</span>
                      </span>
                      <span className="template-arrow"><ArrowUpRight size={15} strokeWidth={1.8} /></span>
                    </button>
                  );
                })}
              </div>
            </section>

            <footer className="home-footnote">
              <span><Cloud size={14} strokeWidth={1.7} /> Your work stays available offline</span>
              <span><Command size={13} strokeWidth={1.8} /> Press <kbd>⌘ K</kbd> for quick actions</span>
            </footer>
          </div>
        ) : filter === "all" && (documents.length === 0 || filtered.length === 0) ? (
          <div className="empty-state compact-empty page-transition">
            <div className="eyebrow">{search.trim() ? "SEARCH / NO RESULTS" : "DOCUMENTS"}</div>
            <h1>{search.trim() ? "No matches" : "No documents"}</h1>
            <p>{search.trim() ? "No documents match “" + search.trim() + "”." : "Create your first document or start from a template."}</p>
            {!search.trim() && <button type="button" className="primary-button" onClick={createDocument} disabled={creating}><Plus size={15} /> New document</button>}
          </div>
        ) : (
          <div className="dashboard workspace-dashboard" data-view={workspaceView}>
            <header className="dashboard-hero">
              <div className="dashboard-intro">
                <div className="dashboard-kicker">
                  <span className="dashboard-kicker-mark"><Sparkles size={13} strokeWidth={1.8} /></span>
                  <span>{workspaceView === "mine" ? "YOUR SPACE / OWNED" : workspaceView === "shared" ? "COLLAB / SHARED" : workspaceView === "favorites" ? "LIBRARY / SAVED" : "WORKSPACE / OVERVIEW"}</span>
                  <span className="dashboard-kicker-rule" />
                </div>
                <h1 className="dashboard-title">{workspaceView === "mine" ? "Your documents" : workspaceView === "shared" ? "Shared with you" : workspaceView === "favorites" ? "Your favorites" : "Welcome back"}<span className="dashboard-title-period">.</span></h1>
                <p className="dashboard-sub">{workspaceView === "mine" ? "The work you own and keep moving forward." : workspaceView === "shared" ? "Documents where you collaborate with other people." : workspaceView === "favorites" ? "Your most important documents, close at hand." : "Everything you’re working on, gathered in one quiet space."}</p>
              </div>
              <div className="dashboard-hero-actions">
                <div className="workspace-status"><span className="workspace-status-dot" /> Personal workspace</div>
                <button type="button" className="primary-button dashboard-new-doc" onClick={createDocument} disabled={creating}>
                  <Plus size={16} strokeWidth={2.1} />
                  <span>{creating ? "Creating…" : "New document"}</span>
                  <ArrowUpRight size={15} strokeWidth={1.9} />
                </button>
              </div>
            </header>

            <section className="workspace-hub-section" aria-labelledby="workspace-hub-title">
              <div className="dashboard-section-heading workspace-hub-heading">
                <div><div className="eyebrow">WORKSPACE / 01</div><h2 id="workspace-hub-title">Workspace hub</h2><p>Your next step, in one place.</p></div>
                <span className="dashboard-live-label"><span /> Live workspace</span>
              </div>
              <div className="workspace-hub-layout">
                <div className="workspace-hub-main">
                  <div className="workspace-hub-grid">
                <button type="button" className="workspace-hub-card hub-inbox" onClick={() => chooseDashboardFolder("shared")}>
                  <span className="hub-card-icon"><Inbox size={19} strokeWidth={1.7} /></span>
                  <span className="hub-card-copy"><span className="hub-card-kicker">INBOX</span><strong>Shared with you</strong><small>Open documents from collaborators.</small></span>
                  <span className="hub-card-trailing"><b>{String(sharedDocumentCount).padStart(2, "0")}</b><ArrowUpRight size={16} /></span>
                </button>
                <button type="button" className="workspace-hub-card hub-comments" onClick={openCommentsHub} data-testid="workspace-hub-comments">
                  <span className="hub-card-icon"><MessageCircle size={19} strokeWidth={1.7} /></span>
                  <span className="hub-card-copy"><span className="hub-card-kicker">DISCUSSION</span><strong>Comments</strong><small>Jump into the latest document thread.</small></span>
                  <span className="hub-card-trailing hub-action-indicator"><ArrowUpRight size={16} /></span>
                </button>
                <button type="button" className={"workspace-hub-card hub-calendar" + (calendarOpen ? " is-expanded" : "")} onClick={() => { if (!signedIn) { toast.info("Sign in to use the workspace calendar."); return; } setCalendarOpen((open) => !open); }} aria-expanded={calendarOpen} aria-controls="workspace-calendar-panel" aria-disabled={!signedIn} title={signedIn ? "Open calendar" : "Sign in to use the workspace calendar"}>
                  <span className="hub-card-icon"><CalendarDays size={19} strokeWidth={1.7} /></span>
                  <span className="hub-card-copy"><span className="hub-card-kicker">CALENDAR</span><strong>Calendar</strong><small>Browse dates and plan your week.</small></span>
                  <span className="hub-card-trailing hub-action-indicator"><ArrowUpRight size={16} className="hub-calendar-arrow" /></span>
                </button>
                <button type="button" className="workspace-hub-card hub-plans" onClick={() => void createFromTemplate("Project brief")} disabled={creating}>
                  <span className="hub-card-icon"><ListChecks size={19} strokeWidth={1.7} /></span>
                  <span className="hub-card-copy"><span className="hub-card-kicker">PLANS</span><strong>Project brief</strong><small>Turn a thought into a clear plan.</small></span>
                  <span className="hub-card-trailing hub-action-indicator"><Plus size={16} /></span>
                </button>
                <button type="button" className="workspace-hub-card hub-edits" onClick={() => { setSortBy("updated"); chooseDashboardFolder("all"); }}>
                  <span className="hub-card-icon"><Activity size={19} strokeWidth={1.7} /></span>
                  <span className="hub-card-copy"><span className="hub-card-kicker">RECENT EDITS</span><strong>{filtered[0]?.title || "No edits yet"}</strong><small>{filtered[0] ? "Updated " + relativeTime(filtered[0].updated_at) : "Your latest activity will appear here."}</small></span>
                  <span className="hub-card-trailing"><b>{String(filtered.length).padStart(2, "0")}</b><ArrowUpRight size={16} /></span>
                </button>

              </div>
              <div id="workspace-calendar-panel" className={"calendar-accordion" + (calendarOpen ? " is-open" : "")} aria-hidden={!calendarOpen}>
                <div className="calendar-accordion-inner">
                  <WorkspaceCalendar open={calendarOpen} apiBase={API} documents={documents} />
                </div>
              </div>
                </div>
                <aside className="workspace-stats-sidebar" aria-labelledby="workspace-stats-title">
                  <div className="workspace-stats-heading">
                    <span className="workspace-stats-icon"><BarChart3 size={17} strokeWidth={1.8} /></span>
                    <div><span className="workspace-stats-kicker">LIVE / OVERVIEW</span><h3 id="workspace-stats-title">Workspace pulse</h3></div>
                    <span className="workspace-stats-live" aria-label="Live stats" />
                  </div>
                  <p className="workspace-stats-description">Your library, at a glance.</p>
                  <div className="workspace-stats-list">
                    <div className="workspace-stat-row"><span><FileText size={14} /> Documents</span><strong>{String(documents.length).padStart(2, "0")}</strong></div>
                    <div className="workspace-stat-row"><span><Pencil size={14} /> Owned by you</span><strong>{String(ownedDocumentCount).padStart(2, "0")}</strong></div>
                    <div className="workspace-stat-row"><span><Users size={14} /> Shared with you</span><strong>{String(sharedDocumentCount).padStart(2, "0")}</strong></div>
                    <div className="workspace-stat-row"><span><Star size={14} /> Favorites</span><strong>{String(favoriteDocumentCount).padStart(2, "0")}</strong></div>
                  </div>
                  <button type="button" className="workspace-stats-library-link" onClick={() => chooseDashboardFolder("all")}>View document library <ArrowUpRight size={14} /></button>
                </aside>
              </div>
            </section>

            <section className="dashboard-collections" aria-labelledby="collections-title">
              <div className="dashboard-section-heading">
                <div>
                  <div className="eyebrow">YOUR LIBRARY / 02</div>
                  <h2 id="collections-title">Smart folders</h2>
                  <p>Jump straight to the work you need.</p>
                </div>
                <span className="dashboard-count-badge">{documents.length} {documents.length === 1 ? "document" : "documents"}</span>
              </div>
              <div className="collection-folder-grid">
                {collectionFolders.map((folder) => (
                  <article
                    key={folder.id}
                    className={"smart-folder-card" + (dashboardFolder === folder.id ? " is-active" : "")}
                    style={{ "--smart-folder-accent": "var(--accent)" } as CSSProperties}
                  >
                    <div className="smart-folder-meta">
                      <span className="smart-folder-title">{folder.label}</span>
                      <span className="smart-folder-count" aria-label={folder.count + " documents"}>
                        <strong>{String(folder.count).padStart(2, "0")}</strong>
                        <span>DOCS</span>
                      </span>
                    </div>
                    <div className="smart-folder-visual">
                      <Folder
                        mode="flap"
                        variant="solid"
                        layout="stack"
                        label={folder.label}
                        color={folder.color}
                        paperColor="#f4f5f8"
                        size={0.78}
                        theme={theme}
                        frost={0}
                        intro={false}
                        tilt={0.28}
                        speed={0.95}
                        bounce={0.34}
                        items={folder.items}
                        draggable={false}
                        zoomOnClick={false}
                        onItemClick={handleSmartFolderItemClick}
                      />
                    </div>
                    <div className="smart-folder-footer">
                      <span>{folder.description}</span>
                      <span className="smart-folder-open" aria-hidden="true"><ArrowUpRight size={14} strokeWidth={1.8} /></span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="workspace-quick-actions" aria-labelledby="quick-actions-title">
              <div className="dashboard-section-heading workspace-quick-actions-heading">
                <div>
                  <div className="eyebrow">WORKFLOW / 03</div>
                  <h2 id="quick-actions-title">Quick actions</h2>
                  <p>Start something new or jump straight to a command.</p>
                </div>
              </div>
              <div className="workspace-action-grid">
                <button type="button" className="workspace-action-card" onClick={() => void createDocument()} disabled={creating}>
                  <span className="workspace-action-icon"><Plus size={18} strokeWidth={1.8} /></span>
                  <span className="workspace-action-copy"><strong>New document</strong><small>Start with a clean page.</small></span>
                  <ArrowUpRight size={16} className="workspace-action-arrow" />
                </button>
                <button type="button" className="workspace-action-card" onClick={() => setTemplateOpen(true)}>
                  <span className="workspace-action-icon"><LayoutTemplate size={18} strokeWidth={1.7} /></span>
                  <span className="workspace-action-copy"><strong>Templates</strong><small>Start from a proven structure.</small></span>
                  <ArrowUpRight size={16} className="workspace-action-arrow" />
                </button>
                <button type="button" className="workspace-action-card" onClick={() => setCmdOpen(true)}>
                  <span className="workspace-action-icon"><Command size={18} strokeWidth={1.7} /></span>
                  <span className="workspace-action-copy"><strong>Command palette</strong><small>Search documents and run actions.</small></span>
                  <span className="workspace-action-shortcut"><kbd>Ctrl K</kbd><kbd>⌘ K</kbd></span>
                </button>
              </div>
            </section>

            <footer className="dashboard-footer">
              <span><FolderOpen size={14} strokeWidth={1.7} /> Open a folder, then select a document sheet</span>
              <span><Command size={13} strokeWidth={1.8} /> Command palette <kbd>Ctrl / ⌘ K</kbd></span>
            </footer>
          </div>

        )}
        {shareOpen && active && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShareOpen(false); }}>
            <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
              <div className="modal-heading"><div><div className="eyebrow">COLLABORATION</div><h2 id="share-title">Share document</h2></div><button className="modal-close" onClick={() => setShareOpen(false)} aria-label="Close"><X size={15} /></button></div>
              <p className="modal-copy">Invite a teammate, or create a public view link without an account.</p>
              {publicLink && <p className="share-feedback">Public: {publicLink}</p>}
              <form className="share-form" onSubmit={(e) => { e.preventDefault(); void shareDocument(); }}>
                <label htmlFor="invite-email">Email address</label>
                <input id="invite-email" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" />
                <label htmlFor="invite-role">Permission</label>
                <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}><option value="editor">Can edit</option><option value="viewer">Can view</option></select>
                <div className="share-feedback" role="status">{shareMessage}</div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyDocumentLink()}>Copy app link</button>
                  <button type="button" className="secondary-button" onClick={() => void ensurePublicLink()} disabled={publicBusy}>{publicBusy ? "Creating…" : "Public view link"}</button>
                  <button type="button" className="secondary-button" onClick={() => setShareOpen(false)}>Close</button>
                  <button type="submit" className="primary-button" disabled={sharing}>{sharing ? "Sharing…" : "Grant access"}</button>
                </div>
              </form>
            </section>
          </div>
        )}
        {emptyTrashConfirm && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) setEmptyTrashConfirm(false); }}>
            <section className="share-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="empty-trash-title" aria-describedby="empty-trash-description">
              <div className="modal-heading">
                <div><div className="eyebrow danger-eyebrow">PERMANENT REMOVAL</div><h2 id="empty-trash-title">Empty Trash?</h2></div>
                <button className="modal-close" onClick={() => { if (!deleting) setEmptyTrashConfirm(false); }} aria-label="Close" disabled={deleting}><X size={15} /></button>
              </div>
              <p className="modal-copy" id="empty-trash-description">Permanently delete every document you own in Trash, including local documents. This cannot be undone.</p>
              <div className="hold-confirm-hint"><Trash2 size={14} strokeWidth={1.8} /><span>Press and hold for 2 seconds to confirm</span></div>
              <div className="hold-confirm-control">
                <HoldButton
                  doneLabel="Trash emptied"
                  icon={<Trash2 size={15} strokeWidth={1.9} />}
                  doneIcon={<Check size={15} strokeWidth={2} />}
                  backgroundColor="#26181e"
                  fillColor="#bd4260"
                  textColor="#f4e8ec"
                  fillTextColor="#ffffff"
                  size="md"
                  radius={12}
                  fillDirection="right"
                  holdTime={2000}
                  releaseTime={200}
                  pressScale={0.98}
                  wave
                  waveAmplitude={5}
                  glow
                  resetAfter={1200}
                  disabled={deleting}
                  onHold={() => void emptyTrashNow()}
                  className="delete-hold-button"
                >Hold to empty trash</HoldButton>
              </div>
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { if (!deleting) setEmptyTrashConfirm(false); }} disabled={deleting}>Cancel</button></div>
            </section>
          </div>
        )}
        {deleteTarget && (
          <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) { setDeleteTarget(null); setDeleteMode("trash"); } }}>
            <section className="share-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
              <div className="modal-heading">
                <div>
                  <div className="eyebrow danger-eyebrow">{deleteMode === "permanent" ? "PERMANENT REMOVAL" : "DESTRUCTIVE ACTION"}</div>
                  <h2 id="delete-dialog-title">{deleteMode === "permanent" ? "Delete forever?" : "Move document to trash?"}</h2>
                </div>
                <button className="modal-close" onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteMode("trash"); } }} aria-label="Close" disabled={deleting}><X size={15} /></button>
              </div>
              <p className="modal-copy" id="delete-dialog-description">
                <strong>{deleteTarget.title}</strong>{deleteMode === "permanent" ? " will be permanently deleted. This cannot be undone." : " will be moved to Trash, where you can restore it later."}
              </p>
              <div className="hold-confirm-hint"><Trash2 size={14} strokeWidth={1.8} /><span>Press and hold for 2 seconds to confirm</span></div>
              <div className="hold-confirm-control">
                <HoldButton
                  doneLabel={deleteMode === "permanent" ? "Deleted" : "Moved to trash"}
                  icon={<Trash2 size={15} strokeWidth={1.9} />}
                  doneIcon={<Check size={15} strokeWidth={2} />}
                  backgroundColor="#26181e"
                  fillColor="#bd4260"
                  textColor="#f4e8ec"
                  fillTextColor="#ffffff"
                  size="md"
                  radius={12}
                  fillDirection="right"
                  holdTime={2000}
                  releaseTime={200}
                  pressScale={0.98}
                  wave
                  waveAmplitude={5}
                  glow
                  resetAfter={1200}
                  disabled={deleting || deleteTarget.role !== "owner"}
                  onHold={() => {
                    if (deleteMode === "permanent") void hardDeleteDocument(deleteTarget);
                    else void deleteDocument(deleteTarget);
                  }}
                  className="delete-hold-button"
                >
                  {deleteMode === "permanent" ? "Hold to delete forever" : "Hold to move to trash"}
                </HoldButton>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteMode("trash"); } }} disabled={deleting}>Cancel</button>
              </div>
            </section>
          </div>
        )}

        {contextMenu && (
          <div
            ref={contextRef}
            className="context-menu"
            style={{
              top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - (viewMode === "trash" ? 280 : 240))),
              left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 240)),
            }}
            role="menu"
            aria-label="Document actions"
          >
            <button type="button" role="menuitem" onClick={() => { setOpenCommentsForId(null); pendingDocId.current = contextMenu.doc.id; setActive(contextMenu.doc); setContextMenu(null); setSidebarOpen(false); }}>
              <span className="context-menu-icon" aria-hidden="true"><FolderOpen size={16} /></span><span>Open</span>
            </button>
            <button type="button" role="menuitem" onClick={() => startRename(contextMenu.doc)}>
              <span className="context-menu-icon" aria-hidden="true"><Pencil size={16} /></span><span>Rename</span>
            </button>
            <button type="button" role="menuitem" onClick={() => void duplicateDocument(contextMenu.doc)} disabled={viewMode === "trash"}>
              <span className="context-menu-icon" aria-hidden="true"><Files size={16} /></span><span>Duplicate</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setActive(contextMenu.doc); setShareOpen(true); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner" || viewMode === "trash"}>
              <span className="context-menu-icon" aria-hidden="true"><Users size={16} /></span><span>Share…</span>
            </button>
            {viewMode === "trash" ? (
              <>
                <button type="button" role="menuitem" onClick={() => void restoreDocument(contextMenu.doc)}>
                  <span className="context-menu-icon" aria-hidden="true"><ArrowRight size={16} /></span><span>Restore</span>
                </button>
                <div className="context-divider" />
                <button type="button" role="menuitem" className="danger-item" onClick={() => { setDeleteTarget(contextMenu.doc); setDeleteMode("permanent"); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner"}>
                  <span className="context-menu-icon" aria-hidden="true"><Trash2 size={16} /></span><span>Delete forever…</span>
                </button>
              </>
            ) : (
              <>
                <div className="context-divider" />
                <button type="button" role="menuitem" className="danger-item" onClick={() => { setDeleteTarget(contextMenu.doc); setDeleteMode("trash"); setContextMenu(null); }} disabled={contextMenu.doc.role !== "owner"}>
                  <span className="context-menu-icon" aria-hidden="true"><Trash2 size={16} /></span><span>Move to trash…</span>
                </button>
              </>
            )}
          </div>
        )}
      </section>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commandItems} />
      {templateOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setTemplateOpen(false); }}>
          <section className="share-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div><div className="eyebrow">TEMPLATES</div><h2>Start from a template</h2></div>
              <button className="modal-close" onClick={() => setTemplateOpen(false)} aria-label="Close"><X size={15} /></button>
            </div>
            <div className="template-grid">
              {TEMPLATES.map((tpl) => (
                <button key={tpl.id} type="button" className="template-option" onClick={() => void createFromTemplate(tpl.title)} disabled={creating}>
                  <span className="template-option-icon" aria-hidden="true">
                    {tpl.id === "blank" ? <FileText size={21} strokeWidth={1.7} /> :
                      tpl.id === "meeting" ? <NotebookPen size={21} strokeWidth={1.7} /> :
                      tpl.id === "brief" ? <Target size={21} strokeWidth={1.7} /> :
                      <Code2 size={21} strokeWidth={1.7} />}
                  </span>
                  <span className="template-option-copy">
                    <span className="t">{tpl.title}</span>
                    <span className="m">
                      {tpl.id === "blank" ? "A clean page, ready for your ideas." :
                        tpl.id === "meeting" ? "Agenda, notes, decisions, and action items." :
                        tpl.id === "brief" ? "Goals, scope, and project milestones." :
                        "Architecture and implementation details."}
                    </span>
                  </span>
                  <span className="template-option-arrow" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.8} /></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
