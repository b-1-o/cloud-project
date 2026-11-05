"use client";

import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-topbar">
        <Link href="/" className="privacy-back"><ArrowLeft size={15} /> Back to workspace</Link>
        <span className="privacy-brand">collab<span>docs</span></span>
      </header>
      <article className="privacy-content">
        <div className="eyebrow">COLLABDOCS / TRUST</div>
        <h1>Privacy notice<span>.</span></h1>
        <p className="privacy-updated">Product privacy notice · Last updated November 4, 2026</p>
        <p className="privacy-lead">This notice explains how CollabDocs handles documents, local browser storage, and workspace collaboration.</p>

        <section>
          <h2><ShieldCheck size={17} /> Documents and workspace storage</h2>
          <p>When you use CollabDocs without signing in, document metadata and collaborative editor content are saved in your browser on that device. Clearing browser data may remove locally stored documents.</p>
          <p>When you sign in, documents are stored and synchronized through the CollabDocs workspace services. People with access to a shared document may be able to view or edit it according to their assigned role. Do not place sensitive information in a shared document unless you are comfortable sharing it with its collaborators.</p>
        </section>

        <section>
          <h2><LockKeyhole size={17} /> Imported files and security</h2>
          <p>Scanned PDFs are not converted to text and do not require OCR to import. CollabDocs keeps the original PDF bytes and renders pages inside its own theme-aware PDF workspace. Added text, freehand annotations, and hand-drawn signatures can be saved back into the PDF; the original page text is not directly editable. DOCX and supported text formats may be converted into editable rich text; those conversions may not preserve every layout, embedded media, spreadsheet formula, or presentation animation. Original-file uploads are limited to 30 MB.</p>
          <p>Do not import files that you are not authorized to access. Keep your account credentials private and review document sharing permissions before inviting collaborators.</p>
        </section>

        <section>
          <h2>Choices and deletion</h2>
          <p>You can delete documents from the workspace; locally stored documents may also be removed by clearing browser site data. For signed-in documents, deletion follows the workspace Trash and deletion controls.</p>
          <p>For questions about this notice, contact the CollabDocs project owner through the repository.</p>
        </section>

        <p className="privacy-disclaimer">This notice describes the current CollabDocs document and workspace experience. It may be updated as product features and data practices change.</p>
      </article>
    </main>
  );
}
