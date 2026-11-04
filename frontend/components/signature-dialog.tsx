"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, Eraser, PenLine, RotateCcw, X } from "lucide-react";

type Point = { x: number; y: number; pressure: number };
type Stroke = Point[];

type Props = {
  onClose: () => void;
  onInsert: (dataUrl: string) => void;
};

const WIDTH = 960;
const HEIGHT = 300;

export function SignatureDialog({ onClose, onInsert }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([]);
  const [strokeColor, setStrokeColor] = useState("#282129");
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(WIDTH * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineCap = "round";
    context.lineJoin = "round";
    strokesRef.current.forEach((stroke) => {
      if (stroke.length === 0) return;
      context.beginPath();
      context.strokeStyle = strokeColor;
      context.moveTo(stroke[0].x, stroke[0].y);
      for (let index = 1; index < stroke.length; index += 1) {
        const point = stroke[index];
        const previous = stroke[index - 1];
        context.lineWidth = 1.6 + Math.min(1, Math.max(0, point.pressure)) * 2.1;
        context.quadraticCurveTo(previous.x, previous.y, (previous.x + point.x) / 2, (previous.y + point.y) / 2);
      }
      const last = stroke[stroke.length - 1];
      context.lineTo(last.x, last.y);
      context.stroke();
    });
    setHasInk(strokesRef.current.some((stroke) => stroke.length > 1));
  }, [strokeColor]);

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  function pointFromEvent(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
      y: Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)),
      pressure: event.pressure > 0 ? event.pressure : 0.48,
    };
  }

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, [pointFromEvent(event)]];
  }

  function continueStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const active = strokesRef.current[strokesRef.current.length - 1];
    if (active) active.push(point);
    redraw();
  }

  function stopStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may already have released the pointer.
    }
    redraw();
  }

  function clear() {
    strokesRef.current = [];
    redraw();
  }

  function undo() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    redraw();
  }

  function insert() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    onInsert(canvas.toDataURL("image/png"));
  }

  return (
    <div className="signature-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title">
        <header className="signature-dialog-header">
          <div className="signature-heading">
            <span className="signature-icon"><PenLine size={18} /></span>
            <div><span className="eyebrow">DOCUMENT TOOLS / SIGN</span><h2 id="signature-dialog-title">Draw your signature</h2></div>
          </div>
          <button type="button" className="signature-close" onClick={onClose} aria-label="Close signature pad"><X size={17} /></button>
        </header>
        <p className="signature-description">Sign naturally on the canvas. A touchscreen or stylus supports direct drawing; with a standard laptop trackpad, press and drag to write.</p>
        <div className="signature-pad-wrap">
          <canvas
            ref={canvasRef}
            className="signature-canvas"
            aria-label="Signature drawing area"
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={stopStroke}
            onPointerCancel={stopStroke}
            onLostPointerCapture={() => { drawingRef.current = false; }}
          />
          <span className="signature-baseline" />
          <span className="signature-pad-hint">YOUR SIGNATURE</span>
        </div>
        <div className="signature-options">
          <div className="signature-colors" aria-label="Ink color">
            <button type="button" className={strokeColor === "#282129" ? "signature-color active" : "signature-color"} style={{ background: "#282129" }} onClick={() => setStrokeColor("#282129")} aria-label="Dark ink" />
            <button type="button" className={strokeColor === "#243b63" ? "signature-color active" : "signature-color"} style={{ background: "#243b63" }} onClick={() => setStrokeColor("#243b63")} aria-label="Blue ink" />
            <button type="button" className={strokeColor === "#315d4a" ? "signature-color active" : "signature-color"} style={{ background: "#315d4a" }} onClick={() => setStrokeColor("#315d4a")} aria-label="Green ink" />
          </div>
          <div className="signature-pad-actions">
            <button type="button" className="signature-text-button" onClick={undo} disabled={strokesRef.current.length === 0}><RotateCcw size={14} /> Undo</button>
            <button type="button" className="signature-text-button" onClick={clear} disabled={!hasInk}><Eraser size={14} /> Clear</button>
            <button type="button" className="signature-insert-button" onClick={insert} disabled={!hasInk}><Check size={15} /> Insert signature</button>
          </div>
        </div>
      </section>
    </div>
  );
}
