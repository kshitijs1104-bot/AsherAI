import zlib from "node:zlib";

// ---- Document text extraction ("the scanner") ----
//
// WHY THIS EXISTS. Vera's whole claim is that it advises on YOUR business,
// not businesses in general. But the artefacts a founder actually reasons
// about — the P&L, the term sheet, the cap table, the investor update, the
// customer list — live in PDFs and Office files. Until now the honest answer
// for all of those was "I can't read that, paste the text" (see
// attachmentContext.ts), which is exactly the moment a founder decides the
// tool is a toy. A consultant you have to retype your P&L for is not a
// consultant.
//
// DELIBERATELY DEPENDENCY-FREE. pdf-parse / mammoth / xlsx would each be a
// straightforward import, and each would also be a new supply-chain surface
// on the server that reads founders' financial documents, plus a native-ish
// dependency in a workspace that has to install cleanly on Replit. Every
// format below is openly specified and the hard part of each (DEFLATE) is in
// Node's own zlib, so the whole scanner is ~200 lines of parsing against
// public specs with nothing new in package.json.
//
// KNOWN AND ACCEPTED LIMIT: a scanned/photographed document (an image inside
// a PDF, a phone photo of a contract) has no text layer, so nothing here can
// read it. That case is DETECTED, not guessed at — extractDocumentText
// returns `kind: "no-text-layer"` and the caller says so plainly rather than
// inventing content. Silent failure is the only unacceptable outcome; a
// truthful "this looks like a scan, send me a text version" is fine.

export type ExtractionKind = "text" | "no-text-layer" | "unsupported" | "failed";

export interface ExtractedDocument {
  kind: ExtractionKind;
  text: string;
  // Human-readable note for the prompt when kind !== "text", so the model is
  // told WHY it has no content rather than left to assume it has some.
  note?: string;
}

/* -------------------------------------------------------------------------
 * ZIP container (DOCX and XLSX are both ZIPs of XML)
 * ---------------------------------------------------------------------- */

interface ZipEntry {
  name: string;
  read: () => Buffer;
}

// Walks the End Of Central Directory record backwards, then the central
// directory, rather than scanning for local file headers front-to-back —
// local headers can appear inside stored data, the central directory cannot.
function readZipEntries(buf: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  // EOCD is at most 22 bytes + a 64KB comment.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");

    entries.push({
      name,
      read: () => {
        // The local header repeats the name/extra lengths, and they can
        // differ from the central directory's — the data starts after the
        // LOCAL ones.
        if (buf.readUInt32LE(localOffset) !== 0x04034b50) return Buffer.alloc(0);
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const raw = buf.subarray(start, start + compressedSize);
        if (method === 0) return raw; // stored
        if (method === 8) {
          try {
            return zlib.inflateRawSync(raw);
          } catch {
            return Buffer.alloc(0);
          }
        }
        return Buffer.alloc(0); // bzip2/lzma etc — vanishingly rare in Office files
      },
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/* -------------------------------------------------------------------------
 * XML helpers
 * ---------------------------------------------------------------------- */

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" doesn't become "<"
}

/* -------------------------------------------------------------------------
 * DOCX
 * ---------------------------------------------------------------------- */

function extractDocx(buf: Buffer): ExtractedDocument {
  const entries = readZipEntries(buf);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return { kind: "failed", text: "", note: "the .docx has no readable document part" };

  const xml = doc.read().toString("utf8");
  return { kind: "text", text: decodeXmlEntities(docxBodyToText(xml)) };
}

// Structural boundaries are marked with sentinels BEFORE tags are stripped,
// then resolved afterwards. Doing it in one pass of direct replacements does
// not work: every table cell contains its own <w:p>, so a naive "</w:p>
// becomes a newline" splits each cell onto its own line and a cap table or
// term sheet comes out as a column of orphaned values with no rows — which
// is exactly the kind of quietly-wrong data that would then be reasoned over
// as though it were the real document. (Caught by a test, not by review.)
const DOCX_PARA = "@@P@@";
const DOCX_CELL = "@@C@@";
const DOCX_ROW = "@@R@@";

export function docxBodyToText(xml: string): string {
  return xml
    .replace(/<w:br\s*\/?>/g, DOCX_PARA)
    .replace(/<w:tab\s*\/?>/g, "\t")
    .replace(/<\/w:p>/g, DOCX_PARA)
    .replace(/<\/w:tc>/g, DOCX_CELL)
    .replace(/<\/w:tr>/g, DOCX_ROW)
    .replace(/<[^>]+>/g, "")
    // A paragraph break that exists only because a cell wraps its text in a
    // paragraph is not a line break in the document a human sees. The
    // whitespace absorbed with it is the source XML's indentation between
    // tags, which is not content either.
    .replace(/(?:@@P@@|\s)+(?=@@[CR]@@)/g, "")
    .replace(/@@C@@/g, " | ")
    .replace(/@@R@@/g, "\n")
    .replace(/@@P@@/g, "\n")
    // A trailing cell separator at the end of a row, then per-line tidying
    // of the indentation that sat between the original XML tags.
    .replace(/[ \t]*\|[ \t]*(?=\n|$)/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/* -------------------------------------------------------------------------
 * XLSX
 * ---------------------------------------------------------------------- */

// Converts a cell reference ("C7") to a zero-based column index, so blank
// cells keep their column position instead of silently shifting every value
// in the row one place left — which would quietly corrupt a founder's
// financial table into a different set of numbers.
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function extractXlsx(buf: Buffer): ExtractedDocument {
  const entries = readZipEntries(buf);

  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = sharedEntry.read().toString("utf8");
    for (const si of xml.split("<si>").slice(1)) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
      shared.push(decodeXmlEntities(parts.join("")));
    }
  }

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (sheets.length === 0) return { kind: "failed", text: "", note: "the spreadsheet has no readable sheets" };

  const out: string[] = [];
  const MAX_ROWS_PER_SHEET = 400;

  for (const sheet of sheets) {
    const xml = sheet.read().toString("utf8");
    const rows = xml.split("<row").slice(1, MAX_ROWS_PER_SHEET + 1);
    const lines: string[] = [];

    for (const row of rows) {
      const cells: string[] = [];
      for (const cell of [...row.matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g)]) {
        const attrs = cell[1] ?? cell[3] ?? "";
        const inner = cell[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
        const rawValue = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        const inlineStr = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");

        let value: string;
        if (type === "s") value = shared[Number(rawValue)] ?? "";
        else if (type === "inlineStr") value = decodeXmlEntities(inlineStr);
        else value = decodeXmlEntities(rawValue);

        const idx = ref ? columnIndex(ref) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = value;
      }
      // Skip fully-empty rows rather than emitting a wall of commas.
      if (cells.some((c) => c !== "")) lines.push(cells.join(","));
    }

    if (lines.length > 0) {
      const sheetLabel = sheet.name.replace("xl/worksheets/", "").replace(".xml", "");
      out.push(`# ${sheetLabel}\n${lines.join("\n")}`);
    }
  }

  if (out.length === 0) return { kind: "no-text-layer", text: "", note: "the spreadsheet appears to be empty" };
  return { kind: "text", text: out.join("\n\n") };
}

/* -------------------------------------------------------------------------
 * PDF
 * ---------------------------------------------------------------------- */

// Pulls literal strings out of a decoded content stream. PDF text lives in
// `(literal) Tj` and `[(array) -250 (of) (pieces)] TJ` operators; the array
// form is how kerned text is stored, which is most real-world text, so
// handling only Tj would silently drop most of a document.
function textFromContentStream(stream: string): string {
  const out: string[] = [];
  const showText = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;

  for (const block of stream.split(/BT\b/).slice(1)) {
    const body = block.split(/\bET\b/)[0];
    const pieces: string[] = [];
    for (const match of body.matchAll(showText)) {
      const raw = match[0];
      if (raw.startsWith("<")) {
        // Hex string form.
        const hex = raw.slice(1, -1).replace(/\s+/g, "");
        let s = "";
        for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        pieces.push(s);
      } else {
        pieces.push(
          raw
            .slice(1, -1)
            .replace(/\\([nrtbf])/g, (_, c) => ({ n: "\n", r: "\n", t: "\t", b: "", f: "\n" })[c as string] ?? "")
            .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
            .replace(/\\(.)/g, "$1"),
        );
      }
    }
    const line = pieces.join("").replace(/[ \t]{2,}/g, " ").trim();
    if (line) out.push(line);
  }

  return out.join("\n");
}

function extractPdf(buf: Buffer): ExtractedDocument {
  const chunks: string[] = [];
  // Scan for stream…endstream pairs on the raw bytes. Content streams are
  // usually FlateDecode; uncompressed ones exist too (and in older/simpler
  // generators are common), so both are tried.
  let cursor = 0;
  const needle = Buffer.from("stream");
  const endNeedle = Buffer.from("endstream");

  while (cursor < buf.length) {
    const start = buf.indexOf(needle, cursor);
    if (start < 0) break;
    const end = buf.indexOf(endNeedle, start);
    if (end < 0) break;

    // Skip the EOL that must follow the `stream` keyword.
    let dataStart = start + needle.length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;

    const raw = buf.subarray(dataStart, end);
    let decoded: string | null = null;
    try {
      decoded = zlib.inflateSync(raw).toString("latin1");
    } catch {
      const asText = raw.toString("latin1");
      // Only treat an un-inflatable stream as text if it actually looks like
      // a content stream — otherwise binary image data would be "extracted"
      // into gibberish that reads like content to the model.
      decoded = /\bBT\b[\s\S]*\bET\b/.test(asText) ? asText : null;
    }

    if (decoded) {
      const text = textFromContentStream(decoded);
      if (text) chunks.push(text);
    }
    cursor = end + endNeedle.length;
  }

  const text = chunks.join("\n").trim();
  if (!text) {
    return {
      kind: "no-text-layer",
      text: "",
      note: "this PDF has no extractable text layer — it is most likely a scan or photo of a document rather than a digital one",
    };
  }
  return { kind: "text", text };
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isExtractableMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/pdf" ||
    mimeType === DOCX_MIME ||
    mimeType === XLSX_MIME
  );
}

/**
 * Extracts readable text from a document buffer. Never throws — an
 * unparseable file returns `kind: "failed"` with a note, so the caller can
 * tell the founder the truth instead of the model inventing contents.
 */
export function extractDocumentText(buf: Buffer, mimeType: string): ExtractedDocument {
  try {
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      const text = buf.toString("utf8").trim();
      return text ? { kind: "text", text } : { kind: "no-text-layer", text: "", note: "the file is empty" };
    }
    if (mimeType === "application/pdf") return extractPdf(buf);
    if (mimeType === DOCX_MIME) return extractDocx(buf);
    if (mimeType === XLSX_MIME) return extractXlsx(buf);
    // Legacy binary .doc/.xls are a genuinely different (OLE compound) format
    // and are not worth hand-rolling; say so rather than half-reading them.
    return { kind: "unsupported", text: "", note: `${mimeType} can't be read directly` };
  } catch (err) {
    console.error("[documentText] extraction failed", err);
    return { kind: "failed", text: "", note: "the file could not be read" };
  }
}
