"use client";

import { ArrowDownToLine, ExternalLink, FileText, Printer } from "lucide-react";

type Props = {
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  src: string;
};

function formatBytes(value: number): string {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(0) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

export function OriginalFileViewer({ title, fileName, mimeType, size, src }: Props) {
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isImage = mimeType.startsWith("image/");

  return (
    <div className="original-file-workspace">
      <header className="original-file-toolbar">
        <div className="original-file-heading">
          <span className="original-file-icon"><FileText size={18} /></span>
          <div className="original-file-copy">
            <strong>{title}</strong>
            <small>{fileName} · {formatBytes(size)} · Original file</small>
          </div>
        </div>
        <div className="original-file-actions">
          <a className="original-file-action" href={src} download={fileName}><ArrowDownToLine size={15} /><span>Download original</span></a>
          {isPdf && <button type="button" className="original-file-action" onClick={() => window.open(src, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /><span>Open separately</span></button>}
          {isPdf && <button type="button" className="original-file-action" onClick={() => {
            const frame = document.querySelector<HTMLIFrameElement>(".original-file-pdf-frame");
            frame?.contentWindow?.print();
          }}><Printer size={15} /><span>Print</span></button>}
        </div>
      </header>

      <div className="original-file-stage">
        {isPdf ? (
          <iframe className="original-file-pdf-frame" src={src + "#toolbar=1&navpanes=0"} title={"PDF viewer: " + fileName} />
        ) : isImage ? (
          <div className="original-file-image-stage"><img src={src} alt={fileName} /></div>
        ) : (
          <div className="original-file-unsupported">
            <span><FileText size={28} /></span>
            <h2>This file is preserved in its original format.</h2>
            <p>CollabDocs has stored the file as uploaded. Use Download original to open it in a compatible application.</p>
            <a className="primary-button" href={src} download={fileName}><ArrowDownToLine size={15} /> Download original</a>
          </div>
        )}
      </div>
    </div>
  );
}
