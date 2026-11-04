"use client";

import JSZip from "jszip";

export type ImportedDocument = {
  title: string;
  html: string;
  format: string;
};

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 300;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim();
  return withoutExtension.slice(0, 120) || "Imported document";
}

function sanitizeHtml(input: string): string {
  const parsed = new DOMParser().parseFromString(input, "text/html");
  const allowed = new Set([
    "p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s",
    "strike", "del", "ul", "ol", "li", "blockquote", "pre", "code", "a", "hr",
  ]);
  const removeEntirely = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form"]);

  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (!(node instanceof Element)) return "";

    const tag = node.tagName.toLowerCase();
    if (removeEntirely.has(tag)) return "";
    const children = Array.from(node.childNodes).map(clean).join("");
    if (!allowed.has(tag)) return children;

    if (tag === "a") {
      const href = node.getAttribute("href")?.trim() || "";
      if (/^(https?:|mailto:)/i.test(href)) {
        return '<a href="' + escapeHtml(href) + '">' + children + "</a>";
      }
      return children;
    }
    if (tag === "br" || tag === "hr") return "<" + tag + " />";
    return "<" + tag + ">" + children + "</" + tag + ">";
  };

  return Array.from(parsed.body.childNodes).map(clean).join("");
}

function plainTextHtml(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return normalized
    .split(/\n{2,}/)
    .map((part) => "<p>" + escapeHtml(part).replace(/\n/g, "<br />") + "</p>")
    .join("");
}

function markdownHtml(value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  let code: string[] | null = null;
  let paragraph: string[] = [];

  const closeList = () => {
    if (list) output.push("</" + list + ">");
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      const inline = escapeHtml(paragraph.join(" "))
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
      output.push("<p>" + inline + "</p>");
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (code) {
        output.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push("<h" + level + ">" + escapeHtml(heading[2]) + "</h" + level + ">");
    } else if (bullet || ordered) {
      flushParagraph();
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push("<" + list + ">");
      }
      output.push("<li>" + escapeHtml((bullet || ordered)![1]) + "</li>");
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      output.push("<blockquote><p>" + escapeHtml(line.replace(/^>\s?/, "")) + "</p></blockquote>");
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  closeList();
  if (code) output.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
  return output.join("");
}

function xmlDocument(source: string): XMLDocument {
  const parsed = new DOMParser().parseFromString(source, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) {
    throw new Error("The document contains invalid XML and could not be imported.");
  }
  return parsed;
}

function xmlText(element: Element): string {
  return Array.from(element.getElementsByTagNameNS("*", "t"))
    .map((node) => node.textContent || "")
    .join("");
}

async function importDocx(zip: JSZip): Promise<string> {
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("This DOCX file does not contain a readable Word document.");
  const xml = xmlDocument(await file.async("text"));
  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
  const html = paragraphs.map((paragraph) => {
    const runs = Array.from(paragraph.getElementsByTagNameNS("*", "r")).map((run) => {
      let text = Array.from(run.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join("");
      if (Array.from(run.getElementsByTagNameNS("*", "tab")).length) text += "\t";
      text = escapeHtml(text);
      if (Array.from(run.getElementsByTagNameNS("*", "b")).length) text = "<strong>" + text + "</strong>";
      if (Array.from(run.getElementsByTagNameNS("*", "i")).length) text = "<em>" + text + "</em>";
      if (Array.from(run.getElementsByTagNameNS("*", "u")).length) text = "<u>" + text + "</u>";
      return text;
    }).join("");
    const style = paragraph.getElementsByTagNameNS("*", "pStyle")[0]?.getAttribute("w:val") || "";
    const heading = style.match(/heading\s*([1-3])/i);
    const numbered = paragraph.getElementsByTagNameNS("*", "numPr").length > 0;
    if (!runs.trim()) return "";
    if (heading) return "<h" + heading[1] + ">" + runs + "</h" + heading[1] + ">";
    return numbered ? "<p>• " + runs + "</p>" : "<p>" + runs + "</p>";
  }).filter(Boolean);
  return html.join("") || "<p></p>";
}

async function importOdt(zip: JSZip): Promise<string> {
  const file = zip.file("content.xml");
  if (!file) throw new Error("This ODT file does not contain a readable text document.");
  const xml = xmlDocument(await file.async("text"));
  const body = xml.getElementsByTagNameNS("*", "text")[0];
  if (!body) throw new Error("No readable text was found in this ODT file.");
  const blocks = Array.from(body.getElementsByTagName("*")).filter((element) => {
    const name = element.localName.toLowerCase();
    return name === "p" || name === "h";
  });
  return blocks.map((block) => {
    const text = escapeHtml(block.textContent || "");
    if (!text.trim()) return "";
    if (block.localName.toLowerCase() === "h") {
      const level = Math.min(3, Math.max(1, Number(block.getAttribute("text:outline-level") || 1)));
      return "<h" + level + ">" + text + "</h" + level + ">";
    }
    return "<p>" + text + "</p>";
  }).filter(Boolean).join("") || "<p></p>";
}

async function importPptx(zip: JSZip): Promise<string> {
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
  if (!slidePaths.length) throw new Error("No readable slides were found in this PowerPoint file.");
  const slides: string[] = [];
  for (let index = 0; index < slidePaths.length; index += 1) {
    const xml = xmlDocument(await zip.file(slidePaths[index])!.async("text"));
    const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"))
      .map((paragraph) => xmlText(paragraph).trim())
      .filter(Boolean);
    if (!paragraphs.length) continue;
    slides.push("<h2>Slide " + (index + 1) + "</h2>" + paragraphs.map((line) => "<p>" + escapeHtml(line) + "</p>").join(""));
  }
  return slides.join("") || "<p>No extractable text was found in these slides.</p>";
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/\d/g, "");
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

async function importXlsx(zip: JSZip): Promise<string> {
  const sharedFile = zip.file("xl/sharedStrings.xml");
  const shared = sharedFile
    ? Array.from(xmlDocument(await sharedFile.async("text")).getElementsByTagNameNS("*", "si")).map(xmlText)
    : [];
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) throw new Error("This XLSX file does not contain a readable workbook.");
  const workbook = xmlDocument(await workbookFile.async("text"));
  const relationshipFile = zip.file("xl/_rels/workbook.xml.rels");
  const relationships = relationshipFile ? xmlDocument(await relationshipFile.async("text")) : null;
  const targets = new Map<string, string>();
  if (relationships) {
    for (const relation of Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))) {
      const id = relation.getAttribute("Id");
      const target = relation.getAttribute("Target");
      if (id && target) {
        const normalized = target.replace(/^\//, "");
        targets.set(id, normalized.startsWith("xl/") ? normalized : "xl/" + normalized.replace(/^\.\//, ""));
      }
    }
  }

  const sheets: string[] = [];
  for (const sheet of Array.from(workbook.getElementsByTagNameNS("*", "sheet"))) {
    const name = sheet.getAttribute("name") || "Sheet";
    const relationId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const path = relationId ? targets.get(relationId) : undefined;
    const sheetFile = path ? zip.file(path) : null;
    if (!sheetFile) continue;
    const xml = xmlDocument(await sheetFile.async("text"));
    const rows = Array.from(xml.getElementsByTagNameNS("*", "row")).map((row) => {
      const cells = Array.from(row.getElementsByTagNameNS("*", "c"));
      const values: string[] = [];
      for (const cell of cells) {
        const reference = cell.getAttribute("r") || "";
        const index = columnIndex(reference);
        const type = cell.getAttribute("t");
        let value = "";
        if (type === "inlineStr") {
          value = xmlText(cell);
        } else {
          value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || "";
          if (type === "s") value = shared[Number(value)] || "";
          if (type === "b") value = value === "1" ? "TRUE" : "FALSE";
        }
        values[index] = value;
      }
      return values.map((value) => value || "").join("\t");
    }).filter((row) => row.trim());
    if (rows.length) {
      sheets.push("<h2>" + escapeHtml(name) + "</h2><pre><code>" + escapeHtml(rows.join("\n")) + "</code></pre>");
    }
  }
  return sheets.join("") || "<p>No readable cell values were found in this workbook.</p>";
}

async function importPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    await pdf.destroy();
    throw new Error("This PDF has more than " + MAX_PDF_PAGES + " pages. Split it into smaller files and import them separately.");
  }

  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
      if (text) {
        pages.push("<h2>Page " + pageNumber + "</h2><p>" + escapeHtml(text) + "</p>");
      }
    }
  } finally {
    await pdf.destroy();
  }
  if (!pages.length) {
    throw new Error("No selectable text was found in this PDF. Scanned PDFs need OCR before they can be edited.");
  }
  return pages.join("");
}

function importRtf(value: string): string {
  let text = value
    .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(parseInt(match.slice(2), 16)))
    .replace(/\\u(-?\d+)\??/g, (_match, code: string) => String.fromCharCode(Number(code) < 0 ? Number(code) + 65536 : Number(code)))
    .replace(/\\par[d]?\b/g, "\n\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\\~/g, " ")
    .replace(/\\-/g, "")
    .replace(/\\\\/g, "\\");
  return plainTextHtml(text.trim());
}

async function importEpub(zip: JSZip): Promise<string> {
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("This EPUB file is missing its book index.");
  const container = xmlDocument(await containerFile.async("text"));
  const opfPath = container.getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("This EPUB file is missing its book manifest.");
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("The EPUB book manifest could not be opened.");
  const opf = xmlDocument(await opfFile.async("text"));
  const manifest = new Map<string, string>();
  for (const item of Array.from(opf.getElementsByTagNameNS("*", "item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  }
  const base = opfPath.split("/").slice(0, -1).join("/");
  const chapters: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagNameNS("*", "itemref"))) {
    const href = manifest.get(ref.getAttribute("idref") || "");
    if (!href) continue;
    const path = (base ? base + "/" : "") + decodeURIComponent(href.split("#")[0]);
    const chapter = zip.file(path);
    if (!chapter) continue;
    const html = await chapter.async("text");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const body = parsed.body.innerHTML;
    const safe = sanitizeHtml(body);
    if (safe.trim()) chapters.push(safe);
  }
  return chapters.join("") || "<p>No readable chapters were found in this EPUB file.</p>";
}

export async function importDocumentFile(file: File): Promise<ImportedDocument> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Files must be 30 MB or smaller. Split larger documents and import the parts separately.");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const title = titleFromFilename(file.name);
  let html = "";

  if (extension === "pdf") {
    html = await importPdf(file);
  } else if (extension === "docx" || extension === "odt" || extension === "pptx" || extension === "xlsx" || extension === "epub") {
    const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
    if (extension === "docx") html = await importDocx(zip);
    if (extension === "odt") html = await importOdt(zip);
    if (extension === "pptx") html = await importPptx(zip);
    if (extension === "xlsx") html = await importXlsx(zip);
    if (extension === "epub") html = await importEpub(zip);
  } else {
    const content = await file.text();
    if (extension === "html" || extension === "htm") {
      html = sanitizeHtml(content);
    } else if (extension === "md" || extension === "markdown") {
      html = markdownHtml(content);
    } else if (extension === "rtf" || (extension === "doc" && /^\s*{\\rtf/i.test(content))) {
      html = importRtf(content);
    } else if (extension === "doc" && /^\s*</.test(content)) {
      html = sanitizeHtml(content);
    } else if (["txt", "csv", "tsv", "json", "xml", "log", "yaml", "yml", "doc"].includes(extension)) {
      html = extension === "txt" || extension === "doc"
        ? plainTextHtml(content)
        : "<pre><code>" + escapeHtml(content) + "</code></pre>";
    } else {
      throw new Error("This file type is not supported yet. Try DOCX, PDF, ODT, RTF, TXT, Markdown, HTML, CSV, TSV, XLSX, PPTX or EPUB.");
    }
  }

  const safeHtml = sanitizeHtml(html);
  if (!safeHtml.trim()) throw new Error("No readable content was found in this file.");
  return { title, html: safeHtml, format: extension.toUpperCase() };
}
