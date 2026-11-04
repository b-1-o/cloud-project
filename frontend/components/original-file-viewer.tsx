"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDownToLine,
  Check,
  FileText,
  PenLine,
  Save,
  Type,
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
type NewPdfMark =
  | { type: "draw"; page: number; points: Point[] }
  | { type: "text"; page: number; x: number; y: number; text: string }
  | { type: "signature"; page: number; x: number; y: number; dataUrl: string };
type PdfMark = NewPdfMark & { id: string };
type PdfTool = "select" | "draw" | "text" | "signature";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  marks,
  tool,
  signature,
  textValue,
  onPlace,
  onDraw,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  marks: PdfMark[];
  tool: PdfTool;
  signature: string | null;
  textValue: string;
  onPlace: (page: number, point: Point) => void;
  onDraw: (page: number, points: Point[]) => void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [dimensions, setDimensions] = useState({ width: 612 * scale, height: 792 * scale });
  const [stroke, setStroke] = useState<Point[]>([]);

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
        renderTask = page.render({ canvasContext: context, viewport });
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

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === "select") return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (tool === "draw") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setStroke([point]);
      return;
    }
    if (tool === "text" && textValue.trim()) {
      onPlace(pageNumber, point);
      return;
    }
    if (tool === "signature" && signature) onPlace(pageNumber, point);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool !== "draw" || stroke.length === 0) return;
    const point = pointFromEvent(event);
    setStroke((current) => [...current, point]);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool !== "draw" || stroke.length === 0) return;
    event.preventDefault();
    const points = [...stroke, pointFromEvent(event)];
    if (points.length > 1) onDraw(pageNumber, points);
    setStroke([]);
  }

  const pageMarks = marks.filter((mark) => mark.page === pageNumber);
  const width = dimensions.width;
  const height = dimensions.height;

  return (
    <div className="pdf-page-slot" ref={slotRef} style={{ width, minHeight: height }}>
      {visible ? (
        <div className="pdf-page-surface" style={{ width, height }}>
          <canvas ref={canvasRef} aria-label={"PDF page " + pageNumber} />
          <svg
            className={"pdf-markup-layer" + (tool === "select" ? "" : " is-interactive")}
            viewBox={"0 0 " + width + " " + height}
            width={width}
            height={height}
            aria-label={"Annotations on page " + pageNumber}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setStroke([])}
          >
            {pageMarks.map((mark) => {
              if (mark.type === "draw") {
                return <polyline key={mark.id} points={mark.points.map((point) => point.x * width + "," + point.y * height).join(" ")} fill="none" stroke="#171717" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
              }
              if (mark.type === "text") {
                return <text key={mark.id} x={mark.x * width} y={mark.y * height} fill="#171717" fontSize="17" fontFamily="Arial, sans-serif">{mark.text}</text>;
              }
              return <image key={mark.id} href={mark.dataUrl} x={mark.x * width} y={mark.y * height} width={width * 0.28} height={height * 0.09} preserveAspectRatio="xMidYMid meet" />;
            })}
            {stroke.length > 0 && <polyline points={stroke.map((point) => point.x * width + "," + point.y * height).join(" ")} fill="none" stroke="#171717" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
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
  const [tool, setTool] = useState<PdfTool>("select");
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(src);
  const localUrlRef = useRef<string | null>(null);
  const nextMarkId = useRef(0);

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
          await document.destroy();
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

  const addMark = useCallback((mark: NewPdfMark) => {
    nextMarkId.current += 1;
    setMarks((current) => [...current, { ...mark, id: "mark-" + nextMarkId.current } as PdfMark]);
    setSaved(false);
  }, []);

  const placeMark = useCallback((page: number, point: Point) => {
    if (tool === "text" && textValue.trim()) {
      addMark({ type: "text", page, x: point.x, y: point.y, text: textValue.trim() });
      setTool("select");
      return;
    }
    if (tool === "signature" && signature) {
      addMark({ type: "signature", page, x: Math.min(point.x, 0.69), y: Math.min(point.y, 0.9), dataUrl: signature });
      setTool("select");
    }
  }, [tool, textValue, signature, addMark]);

  const addInk = useCallback((page: number, points: Point[]) => {
    addMark({ type: "draw", page, points });
  }, [addMark]);

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
      const font = await document.embedFont(StandardFonts.Helvetica);
      const embeddedSignatures = new Map<string, Awaited<ReturnType<typeof document.embedPng>>>();

      for (const mark of marks) {
        const page = pages[mark.page - 1];
        if (!page) continue;
        const width = page.getWidth();
        const height = page.getHeight();
        if (mark.type === "draw") {
          for (let index = 1; index < mark.points.length; index += 1) {
            const from = mark.points[index - 1];
            const to = mark.points[index];
            page.drawLine({
              start: { x: from.x * width, y: height - from.y * height },
              end: { x: to.x * width, y: height - to.y * height },
              thickness: 2,
              color: rgb(0.08, 0.08, 0.08),
              opacity: 0.95,
            });
          }
        } else if (mark.type === "text") {
          page.drawText(mark.text, {
            x: mark.x * width,
            y: height - mark.y * height - 17,
            size: 16,
            font,
            color: rgb(0.08, 0.08, 0.08),
          });
        } else {
          let image = embeddedSignatures.get(mark.dataUrl);
          if (!image) {
            image = await document.embedPng(dataUrlToBytes(mark.dataUrl));
            embeddedSignatures.set(mark.dataUrl, image);
          }
          const imageWidth = width * 0.28;
          const imageHeight = imageWidth / image.width * image.height;
          page.drawImage(image, {
            x: mark.x * width,
            y: height - mark.y * height - imageHeight,
            width: imageWidth,
            height: imageHeight,
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
      setMarks([]);
      setTool("select");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The edited PDF could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const selectTool = (next: PdfTool) => {
    if (readOnly) return;
    setTool(next);
    setSaved(false);
  };

  const isActive = (value: PdfTool) => tool === value ? "pdf-tool-button is-active" : "pdf-tool-button";

  return (
    <div className="original-file-workspace">
      <div className="pdf-editor-toolbar" role="toolbar" aria-label="PDF editing tools">
        {isPdf && (
          <div className="pdf-tool-group" aria-label="PDF tools">
            <button type="button" className={isActive("select")} onClick={() => setTool("select")} title="Select and scroll" aria-label="Select tool"><Check size={16} /></button>
            <button type="button" className={isActive("draw")} onClick={() => selectTool("draw")} disabled={readOnly} title="Draw on the page" aria-label="Draw"><PenLine size={16} /></button>
            <button type="button" className={isActive("text")} onClick={() => selectTool("text")} disabled={readOnly} title="Add text to the page" aria-label="Add text"><Type size={16} /></button>
            <button type="button" className={isActive("signature")} onClick={() => { if (!readOnly) setSignatureOpen(true); }} disabled={readOnly} title="Create and place a signature" aria-label="Signature"><PenLine size={16} /></button>
          </div>
        )}
        {isPdf && tool === "text" && (
          <input className="pdf-text-entry" aria-label="Text to place" placeholder="Type text, then click a page" value={textValue} onChange={(event) => setTextValue(event.target.value)} />
        )}
        <div className="pdf-toolbar-spacer" />
        {isPdf && (
          <>
            <button type="button" className="pdf-icon-button" onClick={() => setScale((value) => Math.max(0.55, Number((value - 0.1).toFixed(2))))} title="Zoom out" aria-label="Zoom out" disabled={scale <= 0.55}><ZoomOut size={16} /></button>
            <span className="pdf-zoom-value">{Math.round(scale * 100)}%</span>
            <button type="button" className="pdf-icon-button" onClick={() => setScale((value) => Math.min(2.2, Number((value + 0.1).toFixed(2))))} title="Zoom in" aria-label="Zoom in" disabled={scale >= 2.2}><ZoomIn size={16} /></button>
            <span className="pdf-toolbar-divider" />
            <span className="pdf-page-count">{pageCount ? pageCount + (pageCount === 1 ? " page" : " pages") : "PDF"}</span>
            <a className="pdf-icon-button" href={downloadUrl} download={fileName} title="Download original" aria-label="Download original"><ArrowDownToLine size={16} /></a>
            <button type="button" className="pdf-save-button" onClick={() => void savePdf()} disabled={readOnly || marks.length === 0 || saving}>
              <Save size={15} />{saving ? "Saving…" : "Save PDF"}
            </button>
          </>
        )}
        {!isPdf && <a className="pdf-icon-button" href={src} download={fileName} title="Download original" aria-label="Download original"><ArrowDownToLine size={16} /></a>}
      </div>

      {isPdf && tool !== "select" && (
        <div className="pdf-tool-hint">
          {tool === "draw" ? "Draw directly on the page. Select the pointer to scroll normally." : tool === "text" ? "Enter text above, then click where it should appear." : "Click a page to place your signature."}
          {tool === "text" && !textValue.trim() ? " Enter text first." : ""}
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
                  signature={signature}
                  textValue={textValue}
                  onPlace={placeMark}
                  onDraw={addInk}
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
            setSignature(dataUrl);
            setTool("signature");
            setSignatureOpen(false);
          }}
        />
      )}
    </div>
  );
}
