"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDownToLine,
  Check,
  CheckSquare,
  Circle,
  Eraser,
  FileText,
  Highlighter,
  ImagePlus,
  MessageSquare,
  Minus,
  PenLine,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SignatureDialog } from "@/components/signature-dialog";

type Props = {
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  src: string;
  onSave: (blob: Blob) => Promise<void>;
  readOnly?: boolean;
};

type Point = { x: number; y: number };
type MarkBox = { page: number; x: number; y: number; width: number; height: number };
type NewPdfMark =
  | (MarkBox & { type: "draw" | "highlight"; points: Point[]; color: string; strokeWidth: number; opacity: number })
  | (MarkBox & { type: "text"; text: string; color: string; fontSize: number; bold: boolean; italic: boolean })
  | (MarkBox & { type: "image"; dataUrl: string; mimeType: string })
  | (MarkBox & { type: "shape"; shape: "rectangle" | "ellipse" | "line"; color: string; strokeWidth: number; opacity: number })
  | (MarkBox & { type: "checkbox"; checked: boolean; color: string })
  | (MarkBox & { type: "comment"; text: string; color: string });
type PdfMark = NewPdfMark & { id: string };
type PdfTool =
  | "select" | "draw" | "highlight" | "text" | "signature" | "checkbox"
  | "rectangle" | "ellipse" | "line" | "eraser" | "image" | "comment";
type HistoryState = { past: PdfMark[][]; future: PdfMark[][] };
type DragState = {
  id: string;
  mode: "move" | "resize";
  startPoint: Point;
  startMarks: PdfMark[];
  moved: boolean;
};
type PendingImage = { dataUrl: string; mimeType: string };

function cloneMarks(marks: PdfMark[]): PdfMark[] {
  return marks.map((mark) => (
    mark.type === "draw" || mark.type === "highlight"
      ? { ...mark, points: mark.points.map((point) => ({ ...point })) }
      : { ...mark }
  )) as PdfMark[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function colorToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#171717";
  return {
    r: parseInt(normalized.slice(1, 3), 16) / 255,
    g: parseInt(normalized.slice(3, 5), 16) / 255,
    b: parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

function boundsForMark(mark: PdfMark): MarkBox {
  if (mark.type !== "draw" && mark.type !== "highlight") return mark;
  const xs = mark.points.map((point) => point.x);
  const ys = mark.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    page: mark.page,
    x,
    y,
    width: Math.max(0.025, Math.max(...xs) - x),
    height: Math.max(0.025, Math.max(...ys) - y),
  };
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  marks,
  tool,
  selectedMarkId,
  color,
  strokeWidth,
  opacity,
  onPlace,
  onDraw,
  onShape,
  onSelectMark,
  onMarkPointerDown,
  onGestureMove,
  onGestureEnd,
  onDeleteMark,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  marks: PdfMark[];
  tool: PdfTool;
  selectedMarkId: string | null;
  color: string;
  strokeWidth: number;
  opacity: number;
  onPlace: (page: number, point: Point) => void;
  onDraw: (page: number, points: Point[], kind: "draw" | "highlight") => void;
  onShape: (page: number, shape: "rectangle" | "ellipse" | "line", start: Point, end: Point) => void;
  onSelectMark: (id: string | null) => void;
  onMarkPointerDown: (id: string, mode: "move" | "resize", point: Point) => void;
  onGestureMove: (point: Point) => void;
  onGestureEnd: () => void;
  onDeleteMark: (id: string) => void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [dimensions, setDimensions] = useState({ width: 612 * scale, height: 792 * scale });
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [draftShape, setDraftShape] = useState<{ start: Point; end: Point } | null>(null);

  useEffect(() => {
    const element = slotRef.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "900px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    const render = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !context) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        setDimensions({ width: viewport.width, height: viewport.height });
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, viewport.width, viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          console.error("PDF page render failed", error);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, scale, visible]);

  function pointFromClient(clientX: number, clientY: number): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handleMarkPointerDown(
    event: ReactPointerEvent<SVGGElement>,
    mark: PdfMark,
  ) {
    if (tool === "eraser") {
      event.preventDefault();
      event.stopPropagation();
      onDeleteMark(mark.id);
      return;
    }
    if (tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromClient(event.clientX, event.clientY);
    onSelectMark(mark.id);
    onMarkPointerDown(mark.id, "move", point);
  }

  function handleResizePointerDown(event: ReactPointerEvent<SVGRectElement>, mark: PdfMark) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromClient(event.clientX, event.clientY);
    onSelectMark(mark.id);
    onMarkPointerDown(mark.id, "resize", point);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const point = pointFromClient(event.clientX, event.clientY);
    if (tool === "select") {
      onSelectMark(null);
      return;
    }
    if (tool === "eraser") return;
    if (tool === "draw" || tool === "highlight" || tool === "rectangle" || tool === "ellipse" || tool === "line") {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (tool === "draw" || tool === "highlight") setDraftPoints([point]);
      else setDraftShape({ start: point, end: point });
      return;
    }
    event.preventDefault();
    onPlace(pageNumber, point);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = pointFromClient(event.clientX, event.clientY);
    if (draftPoints.length > 0) {
      setDraftPoints((current) => [...current, point]);
      return;
    }
    if (draftShape) {
      setDraftShape((current) => current ? { ...current, end: point } : null);
      return;
    }
    if (tool === "select") onGestureMove(point);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const point = pointFromClient(event.clientX, event.clientY);
    if (draftPoints.length > 0) {
      const points = [...draftPoints, point];
      if (points.length > 1) onDraw(pageNumber, points, tool === "highlight" ? "highlight" : "draw");
      setDraftPoints([]);
      return;
    }
    if (draftShape) {
      const shape = tool === "ellipse" ? "ellipse" : tool === "line" ? "line" : "rectangle";
      onShape(pageNumber, shape, draftShape.start, point);
      setDraftShape(null);
      return;
    }
    onGestureEnd();
  }

  const pageMarks = marks.filter((mark) => mark.page === pageNumber);
  const selectedMark = pageMarks.find((mark) => mark.id === selectedMarkId) || null;
  const width = dimensions.width;
  const height = dimensions.height;
  const selectedBounds = selectedMark ? boundsForMark(selectedMark) : null;

  return (
    <div className="pdf-page-slot" ref={slotRef} style={{ width, minHeight: height }}>
      {visible ? (
        <div className="pdf-page-surface" style={{ width, height }}>
          <canvas ref={canvasRef} aria-label={"PDF page " + pageNumber} />
          <svg
            ref={svgRef}
            className="pdf-markup-layer"
            viewBox={"0 0 " + width + " " + height}
            width={width}
            height={height}
            aria-label={"Annotations on page " + pageNumber}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              setDraftPoints([]);
              setDraftShape(null);
              onGestureEnd();
            }}
            style={{ cursor: tool === "select" ? "default" : tool === "eraser" ? "not-allowed" : "crosshair" }}
          >
            {pageMarks.map((mark) => {
              const box = boundsForMark(mark);
              const isSelected = mark.id === selectedMarkId;
              const common = {
                key: mark.id,
                className: "pdf-mark-item",
                "data-mark-id": mark.id,
                "data-mark-type": mark.type,
                "data-x": mark.x,
                "data-y": mark.y,
                "data-width": mark.width,
                "data-height": mark.height,
                onPointerDown: (event: ReactPointerEvent<SVGGElement>) => handleMarkPointerDown(event, mark),
              };
              return (
                <g {...common}>
                  <rect x={box.x * width} y={box.y * height} width={box.width * width} height={box.height * height} fill="transparent" pointerEvents="all" />
                  {mark.type === "draw" || mark.type === "highlight" ? (
                    <polyline
                      points={mark.points.map((point) => point.x * width + "," + point.y * height).join(" ")}
                      fill="none"
                      stroke={mark.color}
                      strokeWidth={mark.strokeWidth * (mark.type === "highlight" ? 3.2 : 1)}
                      strokeOpacity={mark.opacity}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  ) : mark.type === "text" ? (
                    <text
                      x={mark.x * width}
                      y={mark.y * height + mark.fontSize}
                      fill={mark.color}
                      fontSize={mark.fontSize}
                      fontWeight={mark.bold ? 700 : 400}
                      fontStyle={mark.italic ? "italic" : "normal"}
                      fontFamily="Arial, sans-serif"
                      pointerEvents="none"
                    >{mark.text}</text>
                  ) : mark.type === "image" ? (
                    <image href={mark.dataUrl} x={mark.x * width} y={mark.y * height} width={mark.width * width} height={mark.height * height} preserveAspectRatio="xMidYMid meet" pointerEvents="none" />
                  ) : mark.type === "shape" ? (
                    mark.shape === "line" ? (
                      <line x1={mark.x * width} y1={mark.y * height} x2={(mark.x + mark.width) * width} y2={(mark.y + mark.height) * height} stroke={mark.color} strokeWidth={mark.strokeWidth} strokeOpacity={mark.opacity} pointerEvents="none" />
                    ) : mark.shape === "ellipse" ? (
                      <ellipse cx={(mark.x + mark.width / 2) * width} cy={(mark.y + mark.height / 2) * height} rx={mark.width * width / 2} ry={mark.height * height / 2} fill="none" stroke={mark.color} strokeWidth={mark.strokeWidth} strokeOpacity={mark.opacity} pointerEvents="none" />
                    ) : (
                      <rect x={mark.x * width} y={mark.y * height} width={mark.width * width} height={mark.height * height} fill="none" stroke={mark.color} strokeWidth={mark.strokeWidth} strokeOpacity={mark.opacity} pointerEvents="none" />
                    )
                  ) : mark.type === "checkbox" ? (
                    <g pointerEvents="none">
                      <rect x={mark.x * width} y={mark.y * height} width={mark.width * width} height={mark.height * height} rx={2} fill="#ffffff" fillOpacity=".92" stroke={mark.color} strokeWidth="1.8" />
                      {mark.checked && <path d={"M " + (mark.x * width + mark.width * width * .18) + " " + (mark.y * height + mark.height * height * .52) + " l " + (mark.width * width * .22) + " " + (mark.height * height * .2) + " l " + (mark.width * width * .43) + " " + (-mark.height * height * .44)} fill="none" stroke={mark.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
                    </g>
                  ) : (
                    <g pointerEvents="none">
                      <rect x={mark.x * width} y={mark.y * height} width={mark.width * width} height={mark.height * height} rx="4" fill="#fff4c2" stroke="#d2ab36" strokeWidth="1.1" />
                      <text x={mark.x * width + 7} y={mark.y * height + 17} fill="#604b12" fontSize="12" fontWeight="600">NOTE</text>
                      <text x={mark.x * width + 7} y={mark.y * height + 33} fill="#604b12" fontSize="11">{mark.text}</text>
                    </g>
                  )}
                </g>
              );
            })}
            {selectedBounds && (
              <g className="pdf-mark-selection" pointerEvents="none">
                <rect
                  x={selectedBounds.x * width - 2}
                  y={selectedBounds.y * height - 2}
                  width={selectedBounds.width * width + 4}
                  height={selectedBounds.height * height + 4}
                  fill="none"
                  stroke="#7c5cff"
                  strokeWidth="1.3"
                  strokeDasharray="5 3"
                  pointerEvents="none"
                />
              </g>
            )}
            {selectedBounds && selectedMark && (
              <rect
                className="pdf-resize-handle"
                data-resize-handle="true"
                x={(selectedBounds.x + selectedBounds.width) * width - 5}
                y={(selectedBounds.y + selectedBounds.height) * height - 5}
                width="10"
                height="10"
                rx="2"
                fill="#7c5cff"
                stroke="#ffffff"
                strokeWidth="1.5"
                pointerEvents="all"
                onPointerDown={(event) => handleResizePointerDown(event, selectedMark)}
              />
            )}
            {draftPoints.length > 0 && (
              <polyline
                points={draftPoints.map((point) => point.x * width + "," + point.y * height).join(" ")}
                fill="none"
                stroke={tool === "highlight" ? color : color}
                strokeWidth={strokeWidth * (tool === "highlight" ? 3.2 : 1)}
                strokeOpacity={tool === "highlight" ? Math.min(opacity, .38) : opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            {draftShape && (
              tool === "line" ? (
                <line x1={draftShape.start.x * width} y1={draftShape.start.y * height} x2={draftShape.end.x * width} y2={draftShape.end.y * height} stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} pointerEvents="none" />
              ) : tool === "ellipse" ? (
                <ellipse cx={(draftShape.start.x + draftShape.end.x) * width / 2} cy={(draftShape.start.y + draftShape.end.y) * height / 2} rx={Math.abs(draftShape.end.x - draftShape.start.x) * width / 2} ry={Math.abs(draftShape.end.y - draftShape.start.y) * height / 2} fill="none" stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} pointerEvents="none" />
              ) : (
                <rect x={Math.min(draftShape.start.x, draftShape.end.x) * width} y={Math.min(draftShape.start.y, draftShape.end.y) * height} width={Math.abs(draftShape.end.x - draftShape.start.x) * width} height={Math.abs(draftShape.end.y - draftShape.start.y) * height} fill="none" stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} pointerEvents="none" />
              )
            )}
          </svg>
          <span className="pdf-page-number">{pageNumber}</span>
        </div>
      ) : (
        <div className="pdf-page-placeholder" style={{ width, height }} />
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

export function OriginalFileViewer({ title, fileName, mimeType, size, src, onSave, readOnly = false }: Props) {
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isImage = mimeType.startsWith("image/");
  const [sourceUrl, setSourceUrl] = useState(src);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(isPdf);
  const [pdfError, setPdfError] = useState("");
  const [scale, setScale] = useState(1);
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const marksRef = useRef<PdfMark[]>([]);
  const historyRef = useRef<HistoryState>({ past: [], future: [] });
  const [historyTick, setHistoryTick] = useState(0);
  const [tool, setTool] = useState<PdfTool>("select");
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [color, setColor] = useState("#171717");
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [opacity, setOpacity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(src);
  const localUrlRef = useRef<string | null>(null);
  const nextMarkId = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectedMark = marks.find((mark) => mark.id === selectedMarkId) || null;

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null = null;
    setPdf(null);
    setPageCount(0);
    setLoadingPdf(isPdf);
    setPdfError("");
    if (!isPdf) {
      setLoadingPdf(false);
      return;
    }
    const openPdf = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error("The PDF file could not be read.");
        const bytes = await response.arrayBuffer();
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        loadingTask = task;
        const document = await task.promise;
        if (cancelled) {
          await task.destroy();
          return;
        }
        setPdf(document);
        setPageCount(document.numPages);
      } catch (error) {
        if (!cancelled) setPdfError(error instanceof Error ? error.message : "This PDF could not be opened.");
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    };
    void openPdf();
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [sourceUrl, isPdf]);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  const commitMarks = useCallback((next: PdfMark[]) => {
    const current = marksRef.current;
    historyRef.current = {
      past: [...historyRef.current.past, cloneMarks(current)].slice(-100),
      future: [],
    };
    const cloned = cloneMarks(next);
    marksRef.current = cloned;
    setMarks(cloned);
    setHistoryTick((value) => value + 1);
    setSaved(false);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (!history.past.length) return;
    const previous = history.past[history.past.length - 1];
    historyRef.current = {
      past: history.past.slice(0, -1),
      future: [cloneMarks(marksRef.current), ...history.future],
    };
    const restored = cloneMarks(previous);
    marksRef.current = restored;
    setMarks(restored);
    setSelectedMarkId(null);
    setHistoryTick((value) => value + 1);
    setSaved(false);
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (!history.future.length) return;
    const next = history.future[0];
    historyRef.current = {
      past: [...history.past, cloneMarks(marksRef.current)].slice(-100),
      future: history.future.slice(1),
    };
    const restored = cloneMarks(next);
    marksRef.current = restored;
    setMarks(restored);
    setSelectedMarkId(null);
    setHistoryTick((value) => value + 1);
    setSaved(false);
  }, []);

  useEffect(() => {
    if (!isPdf || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || Boolean(target?.isContentEditable);
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !typing && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && !typing && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && selectedMarkId && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        commitMarks(marksRef.current.filter((mark) => mark.id !== selectedMarkId));
        setSelectedMarkId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPdf, readOnly, redo, undo, selectedMarkId, commitMarks]);

  const createMark = useCallback((mark: NewPdfMark) => {
    nextMarkId.current += 1;
    const next = { ...mark, id: "mark-" + nextMarkId.current } as PdfMark;
    commitMarks([...marksRef.current, next]);
    setSelectedMarkId(next.id);
    return next.id;
  }, [commitMarks]);

  const addDraw = useCallback((page: number, points: Point[], kind: "draw" | "highlight") => {
    if (readOnly || points.length < 2) return;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    createMark({
      type: kind,
      page,
      x,
      y,
      width: Math.max(.025, Math.max(...xs) - x),
      height: Math.max(.025, Math.max(...ys) - y),
      points,
      color: kind === "highlight" ? "#f5d547" : color,
      strokeWidth: kind === "highlight" ? Math.max(7, strokeWidth) : strokeWidth,
      opacity: kind === "highlight" ? Math.min(.38, opacity) : opacity,
    });
    setTool("select");
  }, [readOnly, color, strokeWidth, opacity, createMark]);

  const addShape = useCallback((page: number, shape: "rectangle" | "ellipse" | "line", start: Point, end: Point) => {
    if (readOnly) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    createMark({
      type: "shape",
      page,
      x,
      y,
      width: Math.max(.025, Math.abs(end.x - start.x)),
      height: Math.max(.025, Math.abs(end.y - start.y)),
      shape,
      color,
      strokeWidth,
      opacity,
    });
    setTool("select");
  }, [readOnly, color, strokeWidth, opacity, createMark]);

  const placeMark = useCallback((page: number, point: Point) => {
    if (readOnly) return;
    if (tool === "text") {
      createMark({
        type: "text", page, x: point.x, y: point.y, width: .34, height: .065,
        text: textValue.trim() || "Text", color, fontSize: 18, bold: false, italic: false,
      });
    } else if (tool === "signature" && pendingImage) {
      createMark({
        type: "image", page, x: Math.min(point.x, .70), y: Math.min(point.y, .88),
        width: .28, height: .10, dataUrl: pendingImage.dataUrl, mimeType: pendingImage.mimeType,
      });
      setPendingImage(null);
    } else if (tool === "image" && pendingImage) {
      createMark({
        type: "image", page, x: Math.min(point.x, .68), y: Math.min(point.y, .78),
        width: .30, height: .20, dataUrl: pendingImage.dataUrl, mimeType: pendingImage.mimeType,
      });
      setPendingImage(null);
    } else if (tool === "checkbox") {
      createMark({
        type: "checkbox", page, x: Math.min(point.x, .94), y: Math.min(point.y, .94),
        width: .045, height: .045, checked: false, color,
      });
    } else if (tool === "comment") {
      createMark({
        type: "comment", page, x: Math.min(point.x, .70), y: Math.min(point.y, .88),
        width: .28, height: .12, text: textValue.trim() || "Comment", color,
      });
    }
    setTool("select");
  }, [readOnly, tool, pendingImage, textValue, color, createMark]);

  const deleteMark = useCallback((id: string) => {
    if (readOnly) return;
    commitMarks(marksRef.current.filter((mark) => mark.id !== id));
    setSelectedMarkId((current) => current === id ? null : current);
  }, [readOnly, commitMarks]);

  const startMarkGesture = useCallback((id: string, mode: "move" | "resize", point: Point) => {
    if (readOnly) return;
    dragRef.current = {
      id,
      mode,
      startPoint: point,
      startMarks: cloneMarks(marksRef.current),
      moved: false,
    };
  }, [readOnly]);

  const moveMarkGesture = useCallback((point: Point) => {
    const gesture = dragRef.current;
    if (!gesture || readOnly) return;
    const dx = point.x - gesture.startPoint.x;
    const dy = point.y - gesture.startPoint.y;
    if (Math.abs(dx) + Math.abs(dy) > .001) gesture.moved = true;
    const next = gesture.startMarks.map((mark) => {
      if (mark.id !== gesture.id) return mark;
      const bounds = boundsForMark(mark);
      if (gesture.mode === "move") {
        const nextX = clamp(bounds.x + dx, 0, 1 - bounds.width);
        const nextY = clamp(bounds.y + dy, 0, 1 - bounds.height);
        const offsetX = nextX - bounds.x;
        const offsetY = nextY - bounds.y;
        if (mark.type === "draw" || mark.type === "highlight") {
          return { ...mark, x: nextX, y: nextY, points: mark.points.map((p) => ({ x: clamp(p.x + offsetX, 0, 1), y: clamp(p.y + offsetY, 0, 1) })) };
        }
        return { ...mark, x: nextX, y: nextY } as PdfMark;
      }
      const nextWidth = clamp(bounds.width + dx, .025, 1 - bounds.x);
      const nextHeight = clamp(bounds.height + dy, .025, 1 - bounds.y);
      if (mark.type === "draw" || mark.type === "highlight") {
        const ratioX = nextWidth / Math.max(.001, bounds.width);
        const ratioY = nextHeight / Math.max(.001, bounds.height);
        return {
          ...mark,
          width: nextWidth,
          height: nextHeight,
          points: mark.points.map((p) => ({
            x: bounds.x + (p.x - bounds.x) * ratioX,
            y: bounds.y + (p.y - bounds.y) * ratioY,
          })),
        };
      }
      return { ...mark, width: nextWidth, height: nextHeight } as PdfMark;
    });
    marksRef.current = next;
    setMarks(next);
    setSaved(false);
  }, [readOnly]);

  const endMarkGesture = useCallback(() => {
    const gesture = dragRef.current;
    if (!gesture) return;
    dragRef.current = null;
    if (gesture.moved) {
      historyRef.current = {
        past: [...historyRef.current.past, gesture.startMarks].slice(-100),
        future: [],
      };
      setHistoryTick((value) => value + 1);
      setSaved(false);
    }
  }, []);

  const updateSelectedMark = (patch: Partial<PdfMark>) => {
    if (!selectedMark || readOnly) return;
    commitMarks(marksRef.current.map((mark) => mark.id === selectedMark.id ? { ...mark, ...patch } as PdfMark : mark));
  };

  const selectTool = (next: PdfTool) => {
    if (readOnly && next !== "select") return;
    setTool(next);
  };

  function handleImageFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setSaveError("Please choose a PNG or JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setPendingImage({ dataUrl: reader.result, mimeType: file.type });
      setTool("image");
    };
    reader.onerror = () => setSaveError("The selected image could not be read.");
    reader.readAsDataURL(file);
  }

  async function savePdf() {
    if (!isPdf || !marks.length || saving || readOnly) return;
    setSaving(true);
    setSaveError("");
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error("The original PDF could not be loaded for saving.");
      const source = await response.arrayBuffer();
      const document = await PDFDocument.load(source);
      const pages = document.getPages();
      const standardFont = await document.embedFont(StandardFonts.Helvetica);
      const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
      const italicFont = await document.embedFont(StandardFonts.HelveticaOblique);
      const boldItalicFont = await document.embedFont(StandardFonts.HelveticaBoldOblique);
      const embeddedImages = new Map<string, Awaited<ReturnType<typeof document.embedPng>>>();

      for (const mark of marks) {
        const page = pages[mark.page - 1];
        if (!page) continue;
        const width = page.getWidth();
        const height = page.getHeight();
        const c = "color" in mark ? colorToRgb(mark.color) : { r: .09, g: .09, b: .09 };
        const pdfColor = rgb(c.r, c.g, c.b);
        if (mark.type === "draw" || mark.type === "highlight") {
          for (let index = 1; index < mark.points.length; index += 1) {
            const from = mark.points[index - 1];
            const to = mark.points[index];
            page.drawLine({
              start: { x: from.x * width, y: height - from.y * height },
              end: { x: to.x * width, y: height - to.y * height },
              thickness: mark.strokeWidth,
              color: pdfColor,
              opacity: mark.opacity,
            });
          }
        } else if (mark.type === "text") {
          const font = mark.bold && mark.italic ? boldItalicFont : mark.bold ? boldFont : mark.italic ? italicFont : standardFont;
          page.drawText(mark.text, {
            x: mark.x * width,
            y: height - mark.y * height - mark.fontSize,
            size: mark.fontSize,
            font,
            color: pdfColor,
            maxWidth: mark.width * width,
            lineHeight: mark.fontSize * 1.25,
          });
        } else if (mark.type === "image") {
          const cacheKey = mark.mimeType + ":" + mark.dataUrl;
          let image = embeddedImages.get(cacheKey);
          if (!image) {
            image = mark.mimeType === "image/jpeg"
              ? await document.embedJpg(dataUrlToBytes(mark.dataUrl))
              : await document.embedPng(dataUrlToBytes(mark.dataUrl));
            embeddedImages.set(cacheKey, image);
          }
          page.drawImage(image, {
            x: mark.x * width,
            y: height - (mark.y + mark.height) * height,
            width: mark.width * width,
            height: mark.height * height,
          });
        } else if (mark.type === "shape") {
          const x = mark.x * width;
          const y = height - (mark.y + mark.height) * height;
          const shapeWidth = mark.width * width;
          const shapeHeight = mark.height * height;
          if (mark.shape === "line") {
            page.drawLine({
              start: { x, y: height - mark.y * height },
              end: { x: x + shapeWidth, y: y },
              thickness: mark.strokeWidth,
              color: pdfColor,
              opacity: mark.opacity,
            });
          } else if (mark.shape === "ellipse") {
            page.drawEllipse({
              x: x + shapeWidth / 2,
              y: y + shapeHeight / 2,
              xScale: shapeWidth / 2,
              yScale: shapeHeight / 2,
              borderColor: pdfColor,
              borderWidth: mark.strokeWidth,
              borderOpacity: mark.opacity,
            });
          } else {
            page.drawRectangle({
              x, y, width: shapeWidth, height: shapeHeight,
              borderColor: pdfColor,
              borderWidth: mark.strokeWidth,
              borderOpacity: mark.opacity,
            });
          }
        } else if (mark.type === "checkbox") {
          const x = mark.x * width;
          const y = height - (mark.y + mark.height) * height;
          const boxWidth = mark.width * width;
          const boxHeight = mark.height * height;
          page.drawRectangle({
            x, y, width: boxWidth, height: boxHeight,
            borderColor: pdfColor,
            borderWidth: 1.6,
            color: rgb(1, 1, 1),
            opacity: .96,
          });
          if (mark.checked) {
            page.drawLine({ start: { x: x + boxWidth * .16, y: y + boxHeight * .5 }, end: { x: x + boxWidth * .4, y: y + boxHeight * .25 }, thickness: 2, color: pdfColor });
            page.drawLine({ start: { x: x + boxWidth * .4, y: y + boxHeight * .25 }, end: { x: x + boxWidth * .85, y: y + boxHeight * .82 }, thickness: 2, color: pdfColor });
          }
        } else {
          const x = mark.x * width;
          const y = height - (mark.y + mark.height) * height;
          page.drawRectangle({
            x, y, width: mark.width * width, height: mark.height * height,
            color: rgb(1, .96, .76),
            borderColor: rgb(.82, .66, .22),
            borderWidth: 1,
          });
          page.drawText(mark.text, {
            x: x + 7, y: y + mark.height * height - 21,
            size: 10, font: boldFont, color: rgb(.32, .25, .08),
            maxWidth: Math.max(35, mark.width * width - 14),
          });
        }
      }

      const bytes = await document.save();
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const output = new Blob([buffer], { type: "application/pdf" });
      await onSave(output);
      const nextUrl = URL.createObjectURL(output);
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = nextUrl;
      setSourceUrl(nextUrl);
      setDownloadUrl(nextUrl);
      marksRef.current = [];
      setMarks([]);
      historyRef.current = { past: [], future: [] };
      setHistoryTick((value) => value + 1);
      setSelectedMarkId(null);
      setTool("select");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The edited PDF could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const isActive = (value: PdfTool) => tool === value ? "pdf-tool-button is-active" : "pdf-tool-button";
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;
  void historyTick;

  return (
    <div className="original-file-workspace">
      <div className="pdf-editor-toolbar" role="toolbar" aria-label="PDF editing tools">
        {isPdf && (
          <>
            <div className="pdf-tool-group" aria-label="History">
              <button type="button" className="pdf-tool-button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo"><Undo2 size={16} /></button>
              <button type="button" className="pdf-tool-button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo"><Redo2 size={16} /></button>
            </div>
            <span className="pdf-toolbar-divider" />
            <div className="pdf-tool-group" aria-label="PDF tools">
              <button type="button" className={isActive("select")} onClick={() => selectTool("select")} title="Select, move and resize annotations" aria-label="Select tool"><Check size={16} /></button>
              <button type="button" className={isActive("draw")} onClick={() => selectTool("draw")} disabled={readOnly} title="Freehand drawing" aria-label="Draw"><PenLine size={16} /></button>
              <button type="button" className={isActive("highlight")} onClick={() => selectTool("highlight")} disabled={readOnly} title="Freehand highlighter" aria-label="Highlighter"><Highlighter size={16} /></button>
              <button type="button" className={isActive("text")} onClick={() => selectTool("text")} disabled={readOnly} title="Add text box" aria-label="Add text"><Type size={16} /></button>
              <button type="button" className={isActive("signature")} onClick={() => { if (!readOnly) setSignatureOpen(true); }} disabled={readOnly} title="Create and place a signature" aria-label="Signature"><PenLine size={16} /></button>
              <button type="button" className={isActive("checkbox")} onClick={() => selectTool("checkbox")} disabled={readOnly} title="Insert checkbox" aria-label="Checkbox"><CheckSquare size={16} /></button>
              <button type="button" className={isActive("rectangle")} onClick={() => selectTool("rectangle")} disabled={readOnly} title="Rectangle shape" aria-label="Rectangle"><Square size={16} /></button>
              <button type="button" className={isActive("ellipse")} onClick={() => selectTool("ellipse")} disabled={readOnly} title="Ellipse shape" aria-label="Ellipse"><Circle size={16} /></button>
              <button type="button" className={isActive("line")} onClick={() => selectTool("line")} disabled={readOnly} title="Line shape" aria-label="Line"><Minus size={16} /></button>
              <button type="button" className={isActive("comment")} onClick={() => selectTool("comment")} disabled={readOnly} title="Add sticky comment" aria-label="Comment"><MessageSquare size={16} /></button>
              <button type="button" className={isActive("eraser")} onClick={() => selectTool("eraser")} disabled={readOnly} title="Erase an annotation by clicking it" aria-label="Eraser"><Eraser size={16} /></button>
              <button type="button" className={isActive("image")} onClick={() => imageInputRef.current?.click()} disabled={readOnly} title="Insert PNG or JPEG image" aria-label="Insert image"><ImagePlus size={16} /></button>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { handleImageFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            </div>
            {(tool === "text" || tool === "comment") && (
              <input className="pdf-text-entry" aria-label={tool === "text" ? "Text to place" : "Comment text"} placeholder={tool === "text" ? "Type text, then click a page" : "Type a note, then click a page"} value={textValue} onChange={(event) => setTextValue(event.target.value)} />
            )}
            {(tool === "draw" || tool === "highlight" || tool === "rectangle" || tool === "ellipse" || tool === "line" || selectedMark) && !readOnly && (
              <div className="pdf-style-controls" aria-label="Annotation style">
                <input type="color" aria-label="Annotation color" value={selectedMark && "color" in selectedMark ? selectedMark.color : color} onChange={(event) => selectedMark ? updateSelectedMark({ color: event.target.value } as Partial<PdfMark>) : setColor(event.target.value)} />
                <label title="Stroke width"> <span>Size</span><input type="range" min="1" max="14" step="0.5" value={selectedMark && ("strokeWidth" in selectedMark) ? selectedMark.strokeWidth : strokeWidth} onChange={(event) => selectedMark && "strokeWidth" in selectedMark ? updateSelectedMark({ strokeWidth: Number(event.target.value) } as Partial<PdfMark>) : setStrokeWidth(Number(event.target.value))} /></label>
              </div>
            )}
          </>
        )}
        <div className="pdf-toolbar-spacer" />
        {isPdf && (
          <>
            <button type="button" className="pdf-icon-button" onClick={() => setScale((value) => Math.max(0.55, Number((value - 0.1).toFixed(2))))} title="Zoom out" aria-label="Zoom out" disabled={scale <= 0.55}><ZoomOut size={16} /></button>
            <span className="pdf-zoom-value">{Math.round(scale * 100)}%</span>
            <button type="button" className="pdf-icon-button" onClick={() => setScale((value) => Math.min(2.2, Number((value + 0.1).toFixed(2))))} title="Zoom in" aria-label="Zoom in" disabled={scale >= 2.2}><ZoomIn size={16} /></button>
            <span className="pdf-toolbar-divider" />
            <span className="pdf-page-count">{pageCount ? pageCount + (pageCount === 1 ? " page" : " pages") : "PDF"}</span>
            <a className="pdf-icon-button" href={downloadUrl} download={fileName} title="Download edited PDF" aria-label="Download original"><ArrowDownToLine size={16} /></a>
            <button type="button" className="pdf-save-button" onClick={() => void savePdf()} disabled={readOnly || marks.length === 0 || saving}>
              <Save size={15} />{saving ? "Saving…" : "Save PDF"}
            </button>
          </>
        )}
        {!isPdf && <a className="pdf-icon-button" href={src} download={fileName} title="Download original" aria-label="Download original"><ArrowDownToLine size={16} /></a>}
      </div>

      {isPdf && tool !== "select" && (
        <div className="pdf-tool-hint">
          {tool === "draw" ? "Draw with the pointer. Select an object to move or resize it."
            : tool === "highlight" ? "Drag across the page to highlight an area."
            : tool === "text" ? "Enter text above, then click where it should appear."
            : tool === "signature" ? "Click a page to place the signature, then drag or resize it."
            : tool === "checkbox" ? "Click on the page to insert a checkbox."
            : tool === "rectangle" || tool === "ellipse" || tool === "line" ? "Drag on the page to create the shape."
            : tool === "comment" ? "Enter a note above, then click the page."
            : tool === "image" ? "Click the page to place the selected image."
            : "Click an annotation to remove it."}
        </div>
      )}
      {selectedMark && tool === "select" && (
        <div className="pdf-selection-panel" aria-label="Selected annotation controls">
          <span className="pdf-selection-label">{selectedMark.type === "image" ? "Image / signature" : selectedMark.type}</span>
          {(selectedMark.type === "text" || selectedMark.type === "comment") && (
            <input
              aria-label="Edit selected text"
              value={selectedMark.text}
              onChange={(event) => updateSelectedMark({ text: event.target.value } as Partial<PdfMark>)}
            />
          )}
          {selectedMark.type === "text" && (
            <label>Font size <input aria-label="Font size" type="number" min="8" max="72" value={selectedMark.fontSize} onChange={(event) => updateSelectedMark({ fontSize: clamp(Number(event.target.value) || 8, 8, 72) } as Partial<PdfMark>)} /></label>
          )}
          {selectedMark.type === "checkbox" && (
            <button type="button" className="pdf-selection-action" onClick={() => updateSelectedMark({ checked: !selectedMark.checked } as Partial<PdfMark>)}>{selectedMark.checked ? "Uncheck" : "Check"}</button>
          )}
          <button type="button" className="pdf-selection-action is-danger" onClick={() => deleteMark(selectedMark.id)}><Trash2 size={14} /> Delete</button>
          <span className="pdf-selection-hint">Drag to move · use the corner handle to resize</span>
        </div>
      )}
      {saveError && <div className="pdf-save-error" role="alert">{saveError}<button type="button" onClick={() => setSaveError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
      {saved && <div className="pdf-saved-status" role="status">Your PDF changes are saved.</div>}

      <main className={"original-file-stage" + (isPdf ? " is-pdf-stage" : "")}>
        {isPdf ? (
          loadingPdf ? (
            <div className="original-file-loading"><span className="status-dot connecting" /> Opening PDF…</div>
          ) : pdfError ? (
            <div className="pdf-open-error"><FileText size={24} /><strong>PDF preview unavailable</strong><p>{pdfError}</p><a className="pdf-save-button" href={src} download={fileName}>Download original</a></div>
          ) : pdf ? (
            <div className="pdf-page-list">
              {Array.from({ length: pageCount }, (_, index) => (
                <PdfPage
                  key={index + 1}
                  pdf={pdf}
                  pageNumber={index + 1}
                  scale={scale}
                  marks={marks}
                  tool={tool}
                  selectedMarkId={selectedMarkId}
                  color={color}
                  strokeWidth={strokeWidth}
                  opacity={opacity}
                  onPlace={placeMark}
                  onDraw={addDraw}
                  onShape={addShape}
                  onSelectMark={setSelectedMarkId}
                  onMarkPointerDown={startMarkGesture}
                  onGestureMove={moveMarkGesture}
                  onGestureEnd={endMarkGesture}
                  onDeleteMark={deleteMark}
                />
              ))}
            </div>
          ) : null
        ) : isImage ? (
          <div className="original-file-image-stage"><img src={src} alt={title} /></div>
        ) : (
          <div className="original-file-unsupported">
            <span><FileText size={28} /></span>
            <h2>Preview is not available for this file type.</h2>
            <p>Your original file is preserved. Download it to open it in a compatible application.</p>
            <a className="pdf-save-button" href={src} download={fileName}><ArrowDownToLine size={15} /> Download original</a>
            <small>{formatBytes(size)}</small>
          </div>
        )}
      </main>

      {signatureOpen && (
        <SignatureDialog
          onClose={() => setSignatureOpen(false)}
          onInsert={(dataUrl) => {
            setPendingImage({ dataUrl, mimeType: "image/png" });
            setTool("signature");
            setSignatureOpen(false);
          }}
        />
      )}
    </div>
  );
}
