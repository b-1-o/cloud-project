"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { GripVertical, Trash2 } from "lucide-react";

type AnnotationKind = "signature" | "draw" | "highlight" | "image" | "text" | "checkbox" | "shape" | "comment";

function AnnotationView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const kind = node.attrs.kind as AnnotationKind;
  const width = Number(node.attrs.width) || 280;
  const height = Number(node.attrs.height) || 100;
  const displayWidth = previewSize?.width ?? width;
  const displayHeight = previewSize?.height ?? height;
  const editable = editor.isEditable;
  const text = String(node.attrs.text || "");
  const resizeHandlers = useRef<{
    move: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    end: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  }>({ move: () => {}, end: () => {} });

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const initial = {
      x: event.clientX,
      y: event.clientY,
      width,
      height,
    };
    const updatePreview = (pointerEvent: ReactPointerEvent<HTMLButtonElement>) => {
      const nextWidth = Math.max(90, Math.min(760, initial.width + pointerEvent.clientX - initial.x));
      const nextHeight = Math.max(42, Math.min(460, initial.height + pointerEvent.clientY - initial.y));
      setPreviewSize({ width: nextWidth, height: nextHeight });
    };
    const finish = (pointerEvent: ReactPointerEvent<HTMLButtonElement>) => {
      updatePreview(pointerEvent);
      const nextWidth = Math.max(90, Math.min(760, initial.width + pointerEvent.clientX - initial.x));
      const nextHeight = Math.max(42, Math.min(460, initial.height + pointerEvent.clientY - initial.y));
      updateAttributes({ width: Math.round(nextWidth), height: Math.round(nextHeight) });
      setPreviewSize(null);
    };
    resizeHandlers.current = { move: updatePreview, end: finish };
  }

  function annotationBody() {
    if (kind === "signature" || kind === "draw" || kind === "highlight" || kind === "image") {
      return (
        <img
          src={String(node.attrs.dataUrl || "")}
          alt={kind === "signature" ? "Signature" : kind === "image" ? "Inserted image" : kind === "highlight" ? "Highlight annotation" : "Drawing annotation"}
          draggable={false}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
        />
      );
    }

    if (kind === "checkbox") {
      return (
        <label className="document-annotation-checkbox" onPointerDown={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={Boolean(node.attrs.checked)}
            disabled={!editable}
            onChange={(event) => updateAttributes({ checked: event.target.checked })}
          />
          <span>{text || "Checklist item"}</span>
        </label>
      );
    }

    if (kind === "shape") {
      const shape = String(node.attrs.shape || "rectangle");
      const color = String(node.attrs.color || "currentColor");
      return (
        <svg viewBox="0 0 320 140" preserveAspectRatio="none" aria-label={shape + " shape"} className="document-annotation-shape">
          {shape === "ellipse" ? (
            <ellipse cx="160" cy="70" rx="145" ry="58" fill="none" stroke={color} strokeWidth="2.5" />
          ) : shape === "line" ? (
            <line x1="10" y1="70" x2="310" y2="70" stroke={color} strokeWidth="2.5" />
          ) : (
            <rect x="8" y="8" width="304" height="124" rx="4" fill="none" stroke={color} strokeWidth="2.5" />
          )}
        </svg>
      );
    }

    if (kind === "comment") {
      return (
        <div className="document-annotation-note">
          <span className="document-annotation-note-label">NOTE</span>
          {editable && selected ? (
            <textarea
              aria-label="Edit annotation note"
              value={text}
              onChange={(event) => updateAttributes({ text: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : <p>{text || "Comment"}</p>}
        </div>
      );
    }

    return (
      <div className="document-annotation-text">
        {editable && selected ? (
          <textarea
            aria-label="Edit annotation text"
            value={text}
            onChange={(event) => updateAttributes({ text: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : <span>{text || "Text"}</span>}
      </div>
    );
  }

  return (
    <NodeViewWrapper
      className={"document-annotation-node" + (selected ? " is-selected" : "") + " is-" + kind}
      data-annotation-kind={kind}
      data-annotation-width={width}
      data-annotation-height={height}
      draggable={editable}
      data-drag-handle=""
      contentEditable={false}
    >
      {selected && editable && (
        <div className="document-annotation-controls" contentEditable={false}>
          <span><GripVertical size={13} /> {kind === "signature" ? "Signature" : kind === "image" ? "Image" : kind === "shape" ? "Shape" : kind}</span>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={deleteNode} aria-label="Delete annotation" title="Delete annotation">
            <Trash2 size={13} />
          </button>
        </div>
      )}
      <div
        className="document-annotation-frame"
        style={{ width: displayWidth, height: displayHeight, maxWidth: "100%" }}
      >
        {annotationBody()}
      </div>
      {selected && editable && (
        <button
          type="button"
          className="document-annotation-resize"
          aria-label="Resize annotation"
          title="Drag to resize"
          onPointerDown={startResize}
          onPointerMove={(event) => resizeHandlers.current.move(event)}
          onPointerUp={(event) => resizeHandlers.current.end(event)}
          onPointerCancel={(event) => resizeHandlers.current.end(event)}
        />
      )}
    </NodeViewWrapper>
  );
}

export const DocumentAnnotation = Node.create({
  name: "documentAnnotation",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      kind: { default: "text", parseHTML: (element: HTMLElement) => element.getAttribute("data-kind") || "text", renderHTML: (attrs: Record<string, unknown>) => ({ "data-kind": attrs.kind }) },
      dataUrl: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-src") || "", renderHTML: (attrs: Record<string, unknown>) => ({ "data-src": attrs.dataUrl }) },
      text: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-text") || element.textContent || "", renderHTML: (attrs: Record<string, unknown>) => ({ "data-text": attrs.text }) },
      shape: { default: "rectangle", parseHTML: (element: HTMLElement) => element.getAttribute("data-shape") || "rectangle", renderHTML: (attrs: Record<string, unknown>) => ({ "data-shape": attrs.shape }) },
      color: { default: "#555555", parseHTML: (element: HTMLElement) => element.getAttribute("data-color") || "#555555", renderHTML: (attrs: Record<string, unknown>) => ({ "data-color": attrs.color }) },
      width: { default: 300, parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-width")) || 300, renderHTML: (attrs: Record<string, unknown>) => ({ "data-width": attrs.width }) },
      height: { default: 100, parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-height")) || 100, renderHTML: (attrs: Record<string, unknown>) => ({ "data-height": attrs.height }) },
      checked: { default: false, parseHTML: (element: HTMLElement) => element.getAttribute("data-checked") === "true", renderHTML: (attrs: Record<string, unknown>) => ({ "data-checked": String(Boolean(attrs.checked)) }) },
      mimeType: { default: "image/png", parseHTML: (element: HTMLElement) => element.getAttribute("data-mime-type") || "image/png", renderHTML: (attrs: Record<string, unknown>) => ({ "data-mime-type": attrs.mimeType }) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-document-annotation]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = Number(node.attrs.width) || 300;
    const height = Number(node.attrs.height) || 100;
    const kind = String(node.attrs.kind || "text");
    const text = String(node.attrs.text || "");
    const attrs = mergeAttributes(HTMLAttributes, {
      "data-document-annotation": "true",
      "data-kind": kind,
      "data-src": node.attrs.dataUrl,
      "data-text": text,
      "data-shape": node.attrs.shape,
      "data-color": node.attrs.color,
      "data-width": width,
      "data-height": height,
      "data-checked": String(Boolean(node.attrs.checked)),
      "data-mime-type": node.attrs.mimeType,
      class: "document-annotation-export",
      style: "width:" + width + "px;height:" + height + "px;max-width:100%",
    });

    if (kind === "signature" || kind === "draw" || kind === "highlight" || kind === "image") {
      return ["div", attrs, ["img", {
        src: String(node.attrs.dataUrl || ""),
        alt: kind === "signature" ? "Signature" : kind === "image" ? "Inserted image" : kind === "highlight" ? "Highlight annotation" : "Drawing annotation",
        style: "display:block;width:100%;height:100%;object-fit:contain",
      }]];
    }

    if (kind === "checkbox") {
      return ["div", attrs, ["label", { class: "document-annotation-checkbox" },
        ["input", { type: "checkbox", ...(node.attrs.checked ? { checked: "checked" } : {}) }],
        ["span", {}, text || "Checklist item"],
      ]];
    }

    if (kind === "shape") {
      const shape = String(node.attrs.shape || "rectangle");
      const color = String(node.attrs.color || "#555555");
      const shapeElement = shape === "ellipse"
        ? ["ellipse", { cx: "160", cy: "70", rx: "145", ry: "58", fill: "none", stroke: color, "stroke-width": "2.5" }]
        : shape === "line"
          ? ["line", { x1: "10", y1: "70", x2: "310", y2: "70", stroke: color, "stroke-width": "2.5" }]
          : ["rect", { x: "8", y: "8", width: "304", height: "124", rx: "4", fill: "none", stroke: color, "stroke-width": "2.5" }];
      return ["div", attrs, ["svg", { viewBox: "0 0 320 140", preserveAspectRatio: "none", width: "100%", height: "100%" }, shapeElement]];
    }

    if (kind === "comment") {
      return ["div", attrs, ["div", { class: "document-annotation-note" },
        ["span", { class: "document-annotation-note-label" }, "NOTE"],
        ["p", {}, text || "Comment"],
      ]];
    }

    return ["div", attrs, ["div", { class: "document-annotation-text" }, text || "Text"]];
  }

  addNodeView() {
    return ReactNodeViewRenderer(AnnotationView);
  },
});
