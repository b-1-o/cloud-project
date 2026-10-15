"use client";

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";

type Item = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: (editor: Editor) => void;
};

const ITEMS: Item[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    keywords: "paragraph text body",
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: "h1",
    label: "Heading 1",
    hint: "Large section title",
    keywords: "h1 title heading",
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "Medium section title",
    keywords: "h2 subtitle heading",
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "Small section title",
    keywords: "h3 heading",
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "Bullet list",
    hint: "Unordered list",
    keywords: "ul list bullet",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    hint: "Ordered list",
    keywords: "ol numbered list",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "Checklist",
    hint: "Task list",
    keywords: "todo task check checkbox",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Blockquote",
    keywords: "blockquote quote",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    hint: "Monospace block",
    keywords: "code pre",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "hr",
    label: "Divider",
    hint: "Horizontal rule",
    keywords: "hr divider line",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

type Props = {
  editor: Editor | null;
  open: boolean;
  query: string;
  position: { top: number; left: number } | null;
  onClose: () => void;
};

export function SlashMenu({ editor, open, query, position, onClose }: Props) {
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.includes(q) ||
        item.hint.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(items.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[active];
        if (item && editor) {
          const { from } = editor.state.selection;
          const textBefore = editor.state.doc.textBetween(Math.max(0, from - 40), from, "\n", "\n");
          const slashIdx = textBefore.lastIndexOf("/");
          if (slashIdx >= 0) {
            const deleteFrom = from - (textBefore.length - slashIdx);
            editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
          }
          item.run(editor);
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, editor, onClose]);

  if (!open || !position || !editor) return null;

  return (
    <div
      className="slash-menu"
      role="listbox"
      aria-label="Insert block"
      style={{ top: position.top, left: position.left }}
    >
      {items.length === 0 && <div className="slash-empty">No matches</div>}
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === active}
          className={"slash-item" + (index === active ? " active" : "")}
          onMouseEnter={() => setActive(index)}
          onClick={() => {
            const { from } = editor.state.selection;
            const textBefore = editor.state.doc.textBetween(Math.max(0, from - 40), from, "\n", "\n");
            const slashIdx = textBefore.lastIndexOf("/");
            if (slashIdx >= 0) {
              const deleteFrom = from - (textBefore.length - slashIdx);
              editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
            }
            item.run(editor);
            onClose();
          }}
        >
          <span className="slash-label">{item.label}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
