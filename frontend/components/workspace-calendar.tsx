"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlarmClock, BellRing, CalendarDays, ChevronLeft, ChevronRight, Clock3,
  ExternalLink, FileText, Link2, Mail, Pencil, Plus, RefreshCw, Trash2, X
} from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/lib/auth";

type CalendarDocument = { id: string; title: string };
type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: number | boolean;
  link_url: string | null;
  email_to: string | null;
  reminder_minutes: number | null;
  document_id: string | null;
  created_at?: string;
  updated_at?: string;
};
type EventDraft = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  linkUrl: string;
  emailTo: string;
  reminderMinutes: string;
  documentId: string;
};
type Props = { open: boolean; apiBase: string; documents: CalendarDocument[] };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function toLocalInput(date: Date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function initialDraft(date: Date): EventDraft {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    start: toLocalInput(start),
    end: toLocalInput(end),
    allDay: false,
    description: "",
    linkUrl: "",
    emailTo: "",
    reminderMinutes: "10",
    documentId: "",
  };
}

async function calendarRequest<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init && init.headers);
  const token = await getAccessToken();
  if (token) headers.set("Authorization", "Bearer " + token);
  if (init && init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const result = await fetch(apiBase + path, { ...init, headers });
  if (!result.ok) {
    const body = await result.json().catch(() => ({})) as { error?: string };
    if (result.status === 401) {
      throw new Error("Authentication required. Please sign in to continue.");
    }
    throw new Error(body.error || "Calendar request failed (" + result.status + ")");
  }
  if (result.status === 204) return undefined as T;
  return result.json() as Promise<T>;
}

function eventTime(event: CalendarEvent) {
  if (event.all_day) return "All day";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(event.start_at));
}

function eventDateRange(event: CalendarEvent) {
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  if (event.all_day) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(start);
  }
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  return day + " · " + time.format(start) + "–" + time.format(end);
}

export function WorkspaceCalendar({ open, apiBase, documents }: Props) {
  const [today, setToday] = useState<Date | null>(null);
  const [month, setMonth] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);

  useEffect(() => {
    const now = new Date();
    setToday(now);
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now);
    if (typeof Notification !== "undefined") setRemindersEnabled(Notification.permission === "granted");
  }, []);

  const days = useMemo(() => {
    if (!month) return [];
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1);
      return {
        date,
        key: dateKey(date),
        inMonth: date.getMonth() === month.getMonth(),
        isToday: Boolean(today && dateKey(today) === dateKey(date)),
        isSelected: Boolean(selectedDate && dateKey(selectedDate) === dateKey(date)),
      };
    });
  }, [month, selectedDate, today]);

  useEffect(() => {
    if (!open || !month) return;
    const activeMonth = month;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      const first = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const until = new Date(first);
      until.setDate(until.getDate() + 42);
      try {
        const result = await calendarRequest<{ events: CalendarEvent[] }>(
          apiBase,
          "/api/calendar/events?from=" + encodeURIComponent(first.toISOString()) + "&to=" + encodeURIComponent(until.toISOString())
        );
        if (!cancelled) setEvents(Array.isArray(result.events) ? result.events : []);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load calendar events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [apiBase, month, open]);

  useEffect(() => {
    if (!open || events.length === 0) return;
    const checkReminders = () => {
      const now = Date.now();
      events.forEach((event) => {
        if (event.reminder_minutes === null || event.reminder_minutes === undefined) return;
        const reminderAt = new Date(event.start_at).getTime() - event.reminder_minutes * 60_000;
        if (reminderAt > now || reminderAt <= now - 45_000) return;
        const key = "collab-calendar-reminder:" + event.id + ":" + event.start_at;
        if (window.localStorage.getItem(key)) return;
        window.localStorage.setItem(key, "1");
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(event.title, { body: "Starts " + eventTime(event) + ". Open Collab Docs to view details." });
        } else {
          toast.info("Reminder: " + event.title, { description: "Starts " + eventTime(event) });
        }
      });
    };
    checkReminders();
    const interval = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(interval);
  }, [events, open]);

  const monthLabel = month
    ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)
    : "Loading calendar";
  const selectedLabel = selectedDate
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(selectedDate)
    : "Choose a date";

  const eventsForDate = (date: Date) => {
    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const until = from + 24 * 60 * 60 * 1000;
    return events.filter((event) => new Date(event.start_at).getTime() < until && new Date(event.end_at).getTime() >= from)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  };

  const selectedEvents = useMemo(() => selectedDate ? eventsForDate(selectedDate) : [], [events, selectedDate]);

  function startNewEvent() {
    const date = selectedDate || today || new Date();
    setEditingId(null);
    setDraft(initialDraft(date));
    setFormOpen(true);
  }

  function startEditing(event: CalendarEvent) {
    setEditingId(event.id);
    setDraft({
      title: event.title,
      start: toLocalInput(new Date(event.start_at)),
      end: toLocalInput(new Date(event.end_at)),
      allDay: Boolean(event.all_day),
      description: event.description || "",
      linkUrl: event.link_url || "",
      emailTo: event.email_to || "",
      reminderMinutes: event.reminder_minutes === null ? "" : String(event.reminder_minutes),
      documentId: event.document_id || "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const start = new Date(draft.start);
    const end = new Date(draft.end);
    if (!draft.title.trim()) {
      toast.error("Add an event title first");
      return;
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      toast.error("The end time must be after the start time");
      return;
    }
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: draft.allDay,
      link_url: draft.linkUrl.trim() || null,
      email_to: draft.emailTo.trim() || null,
      reminder_minutes: draft.reminderMinutes === "" ? null : Number(draft.reminderMinutes),
      document_id: draft.documentId || null,
    };
    try {
      const result = await calendarRequest<{ event: CalendarEvent }>(
        apiBase,
        editingId ? "/api/calendar/events/" + encodeURIComponent(editingId) : "/api/calendar/events",
        { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      setEvents((current) => {
        const next = editingId
          ? current.map((item) => item.id === editingId ? result.event : item)
          : current.concat(result.event);
        return next.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      });
      setSelectedDate(new Date(start.getFullYear(), start.getMonth(), start.getDate()));
      setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
      setFormOpen(false);
      setEditingId(null);
      toast.success(editingId ? "Event updated" : "Event created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent(event: CalendarEvent) {
    try {
      await calendarRequest<void>(apiBase, "/api/calendar/events/" + encodeURIComponent(event.id), { method: "DELETE" });
      setEvents((current) => current.filter((item) => item.id !== event.id));
      toast.success("Event deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete event");
    }
  }

  async function enableReminders() {
    if (typeof Notification === "undefined") {
      toast.error("Browser notifications are not supported here");
      return;
    }
    const permission = await Notification.requestPermission();
    setRemindersEnabled(permission === "granted");
    if (permission === "granted") toast.success("Browser reminders enabled");
    else toast.info("Browser notifications are blocked in your browser settings");
  }

  const updateDraft = (key: keyof EventDraft, value: string | boolean) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  return (
    <section className="calendar-workspace" aria-label="Workspace calendar">
      <div className="calendar-workspace-header">
        <div className="calendar-workspace-title">
          <div className="calendar-eyebrow"><CalendarDays size={13} /> YOUR SCHEDULE</div>
          <h3>{monthLabel}</h3>
          <p>{selectedLabel}</p>
        </div>
        <div className="calendar-controls">
          <button type="button" className="calendar-notification-button" onClick={() => void enableReminders()} title="Enable browser reminders">
            <BellRing size={15} /><span>{remindersEnabled ? "Reminders on" : "Enable reminders"}</span>
          </button>
          <button type="button" aria-label="Previous month" onClick={() => month && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
          <button type="button" aria-label="Next month" onClick={() => month && setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
          <button type="button" className="calendar-today-button" onClick={() => { if (today) { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(today); } }}>Today</button>
        </div>
      </div>

      <div className="calendar-workspace-layout">
        <div className="calendar-month-column">
          <div className="calendar-month-toolbar"><span>MONTH VIEW</span><span>{loading ? <RefreshCw size={12} className="calendar-loading-icon" /> : String(events.length).padStart(2, "0") + " EVENTS"}</span></div>
          <div className="workspace-calendar-grid" role="grid" aria-label={monthLabel}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="workspace-calendar-weekday" role="columnheader">{day}</span>)}
            {days.map((day) => {
              const count = eventsForDate(day.date).length;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="gridcell"
                  className={"workspace-calendar-day" + (day.inMonth ? "" : " is-outside") + (day.isToday ? " is-today" : "") + (day.isSelected ? " is-selected" : "") + (count ? " has-events" : "")}
                  aria-label={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(day.date) + (count ? ", " + count + " events" : "")}
                  aria-pressed={day.isSelected}
                  onClick={() => { setSelectedDate(day.date); if (month && day.date.getMonth() !== month.getMonth()) setMonth(new Date(day.date.getFullYear(), day.date.getMonth(), 1)); }}
                >
                  <span>{day.date.getDate()}</span>{count > 0 && <i className="calendar-day-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="calendar-month-footer"><span className="calendar-date-marker" /> Select a date to view or create events</div>
        </div>

        <aside className="calendar-agenda" aria-label="Selected date agenda">
          <div className="calendar-agenda-heading">
            <div><span className="calendar-agenda-kicker">DAY AGENDA</span><h4>{selectedDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(selectedDate) : "—"}</h4></div>
            <button type="button" className="calendar-add-event" onClick={startNewEvent}><Plus size={15} /> New event</button>
          </div>
          <div className="calendar-agenda-list">
            {loadError && <div className="calendar-error" role="alert">{loadError}<button type="button" onClick={() => setMonth(month ? new Date(month) : new Date())} aria-label="Retry loading calendar"><RefreshCw size={12} /></button></div>}
            {!loadError && loading && <div className="calendar-empty-agenda"><RefreshCw size={15} className="calendar-loading-icon" /><span>Loading events…</span></div>}
            {!loadError && !loading && selectedEvents.length === 0 && (
              <div className="calendar-empty-agenda"><CalendarDays size={20} strokeWidth={1.5} /><strong>Nothing planned</strong><span>Your selected day is open.</span><button type="button" onClick={startNewEvent}><Plus size={13} /> Add an event</button></div>
            )}
            {selectedEvents.map((event) => {
              const linkedDocument = documents.find((document) => document.id === event.document_id);
              return (
                <article className="calendar-event-card" key={event.id}>
                  <span className="calendar-event-rail" />
                  <div className="calendar-event-content">
                    <div className="calendar-event-time"><Clock3 size={12} /> {eventTime(event)}</div>
                    <h5>{event.title}</h5>
                    {!event.all_day && <p className="calendar-event-date">{eventDateRange(event)}</p>}
                    {event.description && <p className="calendar-event-description">{event.description}</p>}
                    <div className="calendar-event-meta">
                      {event.reminder_minutes !== null && event.reminder_minutes !== undefined && <span><AlarmClock size={12} /> {event.reminder_minutes === 0 ? "At start" : event.reminder_minutes + " min before"}</span>}
                      {event.email_to && <a href={"mailto:" + encodeURIComponent(event.email_to) + "?subject=" + encodeURIComponent("Invitation: " + event.title) + "&body=" + encodeURIComponent("You are invited to " + event.title + ".\n" + eventDateRange(event) + (event.link_url ? "\n" + event.link_url : ""))} aria-label={"Email " + event.email_to}><Mail size={12} /> Email</a>}
                      {event.link_url && <a href={event.link_url} target="_blank" rel="noreferrer" aria-label="Open event link"><ExternalLink size={12} /> Link</a>}
                      {linkedDocument && <a href={"/?doc=" + encodeURIComponent(linkedDocument.id)} aria-label={"Open attached document " + linkedDocument.title}><FileText size={12} /> {linkedDocument.title}</a>}
                    </div>
                    <div className="calendar-event-actions">
                      <button type="button" onClick={() => startEditing(event)} aria-label={"Edit " + event.title}><Pencil size={12} /> Edit</button>
                      <button type="button" onClick={() => void removeEvent(event)} aria-label={"Delete " + event.title}><Trash2 size={12} /> Delete</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="calendar-reminder-note">Reminders notify you while Collab Docs is open. Email opens a pre-filled message in your mail app.</p>
        </aside>
      </div>

      <div className={"calendar-event-form-shell" + (formOpen ? " is-open" : "")} aria-hidden={!formOpen}>
        <div className="calendar-event-form-inner">
          {draft && (
            <form className="calendar-event-form" onSubmit={saveEvent}>
              <div className="calendar-event-form-heading"><div><span className="calendar-agenda-kicker">{editingId ? "UPDATE EVENT" : "NEW EVENT"}</span><h4>{editingId ? "Edit event" : "Create an event"}</h4></div><button type="button" className="calendar-close-form" onClick={closeForm} aria-label="Close event form"><X size={15} /></button></div>
              <label className="calendar-field calendar-field-full"><span>Event title</span><input autoFocus={formOpen} maxLength={160} value={draft.title} onChange={(e) => updateDraft("title", e.target.value)} placeholder="Project review" required /></label>
              <div className="calendar-form-row">
                <label className="calendar-field"><span>Start</span><input type="datetime-local" value={draft.start} onChange={(e) => updateDraft("start", e.target.value)} required /></label>
                <label className="calendar-field"><span>End</span><input type="datetime-local" value={draft.end} onChange={(e) => updateDraft("end", e.target.value)} required /></label>
              </div>
              <label className="calendar-all-day"><input type="checkbox" checked={draft.allDay} onChange={(e) => updateDraft("allDay", e.target.checked)} /><span>All day</span></label>
              <label className="calendar-field calendar-field-full"><span>Description / notes</span><textarea rows={2} maxLength={4000} value={draft.description} onChange={(e) => updateDraft("description", e.target.value)} placeholder="Agenda, details, or notes…" /></label>
              <div className="calendar-form-row">
                <label className="calendar-field"><span>Link</span><input type="url" value={draft.linkUrl} onChange={(e) => updateDraft("linkUrl", e.target.value)} placeholder="https://…" /></label>
                <label className="calendar-field"><span>Email invite</span><input type="email" maxLength={254} value={draft.emailTo} onChange={(e) => updateDraft("emailTo", e.target.value)} placeholder="person@example.com" /></label>
              </div>
              <div className="calendar-form-row">
                <label className="calendar-field"><span>Reminder</span><select value={draft.reminderMinutes} onChange={(e) => updateDraft("reminderMinutes", e.target.value)}><option value="">No reminder</option><option value="0">At event time</option><option value="5">5 minutes before</option><option value="10">10 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>
                <label className="calendar-field"><span>Attach document</span><select value={draft.documentId} onChange={(e) => updateDraft("documentId", e.target.value)}><option value="">No document</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
              </div>
              <div className="calendar-form-actions"><button type="button" className="calendar-cancel-button" onClick={closeForm}>Cancel</button><button type="submit" className="calendar-save-button" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create event"}</button></div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
