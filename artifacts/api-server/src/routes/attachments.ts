import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import multer from "multer";
import { db, attachmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { UPLOADS_DIR } from "../lib/attachmentContext";

const router = Router();

// Local disk, not object storage — the simplest thing that works given no
// S3/R2-equivalent credentials exist in this environment. Deliberately
// OUTSIDE dist/ (build.mjs wipes dist/ on every rebuild) so redeploys don't
// silently delete every founder's uploaded files. Swapping to real object
// storage later only touches this one constant and the two handlers below.
//
// UPLOADS_DIR now lives in lib/attachmentContext.ts — the reader (which
// extracts text-like file contents into the prompt) and this writer must
// resolve to the same directory, and two independent `path.resolve` calls
// are exactly the kind of thing that silently drifts apart.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// ---- Why this gate is by EXTENSION, not by the browser's mime string ----
//
// THE BUG THIS CLOSES. The filter used to accept or reject purely on
// `file.mimetype`, which is not a property of the file — it is whatever the
// BROWSER guessed, and on Windows Chrome that guess comes from the registry.
// Machines without an editor registered for a given extension report
// `application/octet-stream` (or ""), so a perfectly readable .md, .json and
// very often .csv were rejected before any code looked at their bytes. The
// founder saw a bare "Upload failed" for a file the scanner could have read
// end to end, on the one screen whose entire job is reading their documents.
//
// The extension is the thing the founder actually chose and the thing the
// file picker's `accept` list is written in, so it is what this gates on.
// The mime is then NORMALISED from it before the row is written, because
// everything downstream (documentText.ts's isExtractableMimeType and
// extractDocumentText, attachmentContext.ts's describeKind) dispatches on
// the stored mime — storing "application/octet-stream" would move the
// failure one step later instead of removing it.
const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
};

// The mime to store for this upload: the extension's canonical type when we
// recognise the extension, otherwise the browser's string if it was itself
// something we accept. Exported so the error message below and the route can
// agree on what was decided.
function resolveMimeType(file: { originalname: string; mimetype: string }): string | null {
  const ext = path.extname(file.originalname).toLowerCase();
  const byExtension = EXTENSION_MIME[ext];
  if (byExtension) return byExtension;
  // No/unknown extension — fall back to a mime we already trust. A bare
  // `application/octet-stream` with no extension really is unidentifiable,
  // and is refused rather than guessed at.
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) return file.mimetype;
  return null;
}

const SUPPORTED_FOR_HUMANS = "PDF, Word, Excel, CSV, Markdown, JSON, plain text, or an image";

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    // Server-generated random filename, never the founder's original
    // filename — the schema comment on attachments.storagePath is the
    // reason: this value must never be usable for path traversal, even if
    // the original filename contained "../" or similar.
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString("hex") + path.extname(file.originalname).slice(0, 10)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!resolveMimeType(file)) {
      // Names the file and what IS accepted. The old message ("Unsupported
      // file type") told the founder nothing they could act on, and in the
      // common case was not even true.
      cb(new Error(`Can't accept "${file.originalname}" — send a ${SUPPORTED_FOR_HUMANS} file.`));
      return;
    }
    cb(null, true);
  },
});

// Multer reports its own failures (size limit, fileFilter rejection) by
// calling next(err), which skips the route entirely and lands in the
// app-level handler as a bare 500. That handler does return JSON, so the
// founder no longer gets an HTML page — but "File too large" arriving as a
// 500 still reads as "the product broke" rather than "your file is 12MB".
// Running multer inside the route lets both failures answer with the right
// status and a sentence the founder can act on.
const runUpload = (req: any, res: any) =>
  new Promise<Error | null>((resolve) => upload.single("file")(req, res, (err: unknown) => resolve((err as Error) ?? null)));

router.post("/attachments", requireAuth, async (req, res) => {
  const uploadError = await runUpload(req, res);
  if (uploadError) {
    const tooLarge = (uploadError as { code?: string }).code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 415).json({
      error: tooLarge ? "That file is over the 10MB limit — send a smaller one, or paste the relevant part." : uploadError.message,
    });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const userId = requireUserId(req);
    const chatId = typeof req.body.chatId === "string" && req.body.chatId.trim() ? Number(req.body.chatId) : null;

    // The canonical type for this extension, not the browser's guess — see
    // the EXTENSION_MIME comment. resolveMimeType already returned non-null
    // for this file in fileFilter, so the fallback here is unreachable in
    // practice and exists only to keep the column non-null.
    const mimeType = resolveMimeType(req.file) ?? "application/octet-stream";

    const [attachment] = await db
      .insert(attachmentsTable)
      .values({
        userId,
        chatId,
        fileName: req.file.originalname,
        mimeType,
        sizeBytes: req.file.size,
        storagePath: req.file.filename,
      })
      .returning();

    return res.json({ id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to save attachment" });
  }
});

router.get("/attachments/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid attachment id" });

  try {
    const userId = requireUserId(req);
    const [attachment] = await db
      .select()
      .from(attachmentsTable)
      .where(and(eq(attachmentsTable.id, id), eq(attachmentsTable.userId, userId)))
      .limit(1);
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });

    const filePath = path.join(UPLOADS_DIR, attachment.storagePath);
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    return res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "File no longer available" });
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load attachment" });
  }
});

export default router;
