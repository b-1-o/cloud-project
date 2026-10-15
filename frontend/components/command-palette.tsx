"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
};

export function CommandPalette({ open, onClose, items }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.hint || "").toLowerCase().includes(q) ||
        (item.group || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[active];
        if (item) {
          item.run();
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-dialog" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmd-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command or search…"
          aria-label="Command search"
        />
        <div className="cmd-list" role="listbox">
          {filtered.length === 0 && <div className="cmd-empty">No commands found</div>}
          {filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={"cmd-item" + (index === active ? " active" : "")}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              <span className="cmd-label">{item.label}</span>
              {item.hint && <span className="cmd-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="cmd-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
