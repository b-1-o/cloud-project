"use client";

import Link from "next/link";
import { ArrowLeft, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

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
        <p className="privacy-lead">Your documents belong to your workspace. This notice explains how CollabDocs handles documents, local storage, and the optional Gmail attachment inbox.</p>

        <section>
          <h2><ShieldCheck size={17} /> Documents and workspace storage</h2>
          <p>When you use CollabDocs without signing in, document metadata and collaborative editor content are saved in your browser on that device. Clearing browser data may remove locally stored documents.</p>
          <p>When you sign in, documents are stored and synchronized through the CollabDocs workspace services. People with access to a shared document may be able to view or edit it according to their assigned role. Do not place sensitive information in a shared document unless you are comfortable sharing it with its collaborators.</p>
        </section>

        <section>
          <h2><Mail size={17} /> Optional Gmail integration</h2>
          <p>Gmail access is optional and starts only after you choose Connect Gmail and approve Google's consent screen. CollabDocs requests the read-only Gmail scope to list recent messages with attachments and download an attachment only after you select it.</p>
          <p>The Gmail panel reads message sender, subject, date, attachment names, and attachment data needed for the import you select. It does not send, delete, archive, label, or otherwise change your emails.</p>
          <p>The Google access token is held in the current browser page's memory and is not sent to the CollabDocs Worker. Refreshing or closing the page clears the in-page connection. Use Disconnect in the Gmail panel to clear the token from the current session.</p>
          <p>Once you import an attachment, the extracted document content becomes a normal CollabDocs document and follows the storage and collaboration behavior described above. The imported document may therefore be synchronized to workspace services when you are signed in.</p>
        </section>

        <section>
          <h2><LockKeyhole size={17} /> Imported files and security</h2>
          <p>Files are parsed in your browser. Supported formats are converted into editable text or rich text; the conversion may not preserve the original layout, embedded media, spreadsheet formulas, or presentation animations. Scanned PDFs require OCR before their text can be edited.</p>
          <p>Do not import files that you are not authorized to access. Keep your account credentials private and review document sharing permissions before inviting collaborators.</p>
        </section>

        <section>
          <h2>Choices and deletion</h2>
          <p>You can disconnect Gmail at any time from the Gmail panel. You can delete imported documents from the workspace; locally stored documents may also be removed by clearing browser site data. For signed-in documents, deletion follows the workspace Trash and deletion controls.</p>
          <p>For questions about this notice, contact the CollabDocs project owner through the repository.</p>
        </section>

        <p className="privacy-disclaimer">This is a product privacy notice draft for the current implementation. It should be reviewed and finalized before a public launch or Google OAuth verification submission.</p>
      </article>
    </main>
  );
}
