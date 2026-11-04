"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Eraser, X } from "lucide-react";

type Props = {
  mode: "draw" | "highlight";
  onClose: () => void;
  onInsert: (dataUrl: string) => void;
};

const WIDTH = 960;
const HEIGHT = 360;

export function AnnotationDrawingDialog({ mode, onClose, onInsert }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const isHighlight = mode === "highlight";

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
      y: Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)),
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = pointFromEvent(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = isHighlight ? "#a4a4a4" : "#252525";
    context.lineWidth = isHighlight ? 34 : 3.2;
    context.globalAlpha = isHighlight ? .34 : .96;
    setHasInk(true);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = pointFromEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stop(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    const context = event.currentTarget.getContext("2d");
    if (context) context.closePath();
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    setHasInk(false);
  }

  function insert() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    onInsert(canvas.toDataURL("image/png"));
  }

  return (
    <div className="annotation-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-dialog-title">
        <header>
          <div>
            <span className="eyebrow">DOCUMENT TOOLS / ANNOTATE</span>
            <h2 id="annotation-dialog-title">{isHighlight ? "Highlight a passage" : "Draw on the document"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawing dialog"><X size={17} /></button>
        </header>
        <p>{isHighlight ? "Mark an area with a soft graphite highlight. Insert it into the document, then move or resize it." : "Draw freely with a mouse, trackpad, touchscreen or stylus. The drawing remains an editable object in the document."}</p>
        <div className={"annotation-drawing-pad" + (isHighlight ? " is-highlight" : "")}>
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            aria-label={isHighlight ? "Highlight drawing area" : "Freehand drawing area"}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={() => { drawingRef.current = false; }}
          />
        </div>
        <footer>
          <button type="button" className="annotation-dialog-secondary" onClick={clear} disabled={!hasInk}><Eraser size={14} /> Clear</button>
          <button type="button" className="annotation-dialog-primary" onClick={insert} disabled={!hasInk}><Check size={15} /> Insert {isHighlight ? "highlight" : "drawing"}</button>
        </footer>
      </section>
    </div>
  );
}
