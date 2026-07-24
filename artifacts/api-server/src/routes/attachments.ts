import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import multer from "multer";
import { db, attachmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";

const router = Router();

// Local disk, not object storage — the simplest thing that works given no
// S3/R2-equivalent credentials exist in this environment. Deliberately
// OUTSIDE dist/ (build.mjs wipes dist/ on every rebuild) so redeploys don't
// silently delete every founder's uploaded files. Swapping to real object
// storage later only touches this one constant and the two handlers below.
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
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
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

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
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Unsupported file type"));
      return;
    }
    cb(null, true);
  },
});

router.post("/attachments", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const userId = requireUserId(req);
    const chatId = typeof req.body.chatId === "string" && req.body.chatId.trim() ? Number(req.body.chatId) : null;

    const [attachment] = await db
      .insert(attachmentsTable)
      .values({
        userId,
        chatId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
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
