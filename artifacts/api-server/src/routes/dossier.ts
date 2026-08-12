import { Router } from "express";
import { z } from "zod/v4";
import { db, attachmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { getGroqClient } from "../lib/groq";
import { getOrCreateActiveProfile } from "../lib/businessProfiles";
import { addCompanyFact } from "../lib/companyMemory";
import { UPLOADS_DIR } from "../lib/attachmentContext";
import { extractDocumentText, isExtractableMimeType } from "../lib/documentText";
import {
  extractDossier,
  generateGapQuestions,
  getDossier,
  saveDossier,
  saveDossierAnswers,
  readExtraction,
  readQuestions,
  readAnswers,
  mergeAnswersIntoFields,
} from "../lib/dossier";
import { buildMonthlyWrap, persistMonthlyWrap, monthLabel } from "../lib/monthlyWrap";
import { currentPeriodMonth } from "../lib/recap";

const router = Router();

// Bounded for the same reason /ai/analyze's input is: this text goes into a
// prompt on a shared TPM pool, and a founder pasting an entire data room
// should be trimmed and answered rather than rejected or allowed to blow the
// budget. The dossier extractor truncates again at its own limit.
const MAX_PASTE_CHARS = 60_000;

const CreateDossierBody = z.object({
  // One of the two must be present — enforced below rather than with a zod
  // union so the error message can say which is missing.
  sourceText: z.string().optional(),
  attachmentId: z.number().optional(),
});

const AnswersBody = z.object({
  answers: z.record(z.string(), z.string()),
});

function serializeDossier(dossier: Awaited<ReturnType<typeof getDossier>>) {
  if (!dossier) return null;
  const extraction = readExtraction(dossier);
  const questions = readQuestions(dossier);
  const answers = readAnswers(dossier);
  const fields = mergeAnswersIntoFields(extraction, questions, answers);
  return {
    id: dossier.id,
    companyName: extraction.companyName,
    oneLine: extraction.oneLine,
    fields,
    questions,
    answers,
    status: dossier.status,
    sourceLabel: dossier.sourceLabel,
    // What share of the file is actually filled in — the one number that
    // tells a founder whether answering the form is worth their next two
    // minutes, computed here rather than in the client so it can't drift.
    completeness: fields.length > 0 ? Math.round((fields.filter((f) => f.value).length / fields.length) * 100) : 0,
    updatedAt: dossier.updatedAt,
  };
}

router.get("/dossier", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const profile = await getOrCreateActiveProfile(userId);
    const dossier = await getDossier(userId, profile?.id ?? null);
    return res.json({ dossier: serializeDossier(dossier) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load your company file" });
  }
});

// The intake. One paste (or one uploaded document) in, a structured company
// file plus a set of questions personalised to what's MISSING from it out.
router.post("/dossier", requireAuth, async (req, res) => {
  const body = CreateDossierBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });

  try {
    const userId = requireUserId(req);
    let sourceText = (body.data.sourceText ?? "").slice(0, MAX_PASTE_CHARS).trim();
    let sourceLabel: string | null = sourceText ? "Pasted" : null;

    // An uploaded document is read through the same scanner the chat uses,
    // so "upload your deck" and "paste your deck" produce an identical file.
    if (body.data.attachmentId) {
      const [attachment] = await db
        .select()
        .from(attachmentsTable)
        .where(and(eq(attachmentsTable.id, body.data.attachmentId), eq(attachmentsTable.userId, userId)))
        .limit(1);
      if (!attachment) return res.status(404).json({ error: "That file could not be found" });
      if (!isExtractableMimeType(attachment.mimeType)) {
        return res.status(422).json({ error: `Vera can't read ${attachment.mimeType} files yet — paste the text instead, or upload a PDF, Word doc, spreadsheet or text file.` });
      }
      const filePath = path.join(UPLOADS_DIR, attachment.storagePath);
      if (!path.resolve(filePath).startsWith(UPLOADS_DIR)) return res.status(400).json({ error: "Invalid file reference" });
      const extracted = extractDocumentText(fs.readFileSync(filePath), attachment.mimeType);
      if (extracted.kind !== "text" || !extracted.text.trim()) {
        // The honest failure. A scan has no text layer, and guessing at its
        // contents is exactly the behaviour the scanner exists to prevent.
        return res.status(422).json({
          error: `Couldn't read "${attachment.fileName}" — ${extracted.note ?? "no readable text in it"}. Paste the text instead and I'll work from that.`,
        });
      }
      sourceText = extracted.text.slice(0, MAX_PASTE_CHARS);
      sourceLabel = `Uploaded: ${attachment.fileName}`;
    }

    if (!sourceText) {
      return res.status(400).json({ error: "Paste something about the company, or attach a document." });
    }

    const groq = await getGroqClient(userId);
    if (!groq) return res.status(400).json({ error: "No Groq API key configured — add one in Settings" });

    const extraction = await extractDossier(groq, sourceText);
    if (!extraction) {
      return res.status(502).json({ error: "Couldn't build the file from that — try again, or paste a bit more detail." });
    }

    const questions = await generateGapQuestions(groq, extraction);
    const profile = await getOrCreateActiveProfile(userId);

    let saved;
    try {
      saved = await saveDossier({
        userId,
        profileId: profile?.id ?? null,
        sourceText,
        sourceLabel,
        extraction,
        questions,
      });
    } catch (err) {
      // Named, not swallowed. "Try again" on a write that can never succeed
      // (a schema that was never pushed, a connection that is refused) sends
      // a founder round the same loop forever — the extraction is already
      // paid for by then, so the least we owe them is the actual reason.
      req.log.error({ err }, "[dossier] save failed");
      return res.status(500).json({ error: `Built the file but couldn't save it — ${describeDbError(err)}` });
    }

    // Feed what was extracted into the memory the CHAT reads, immediately —
    // the point of the dossier is that the next conversation is better, not
    // that there's a nice page to look at. Fire-and-forget: a memory write
    // failing must not fail the intake the founder just completed.
    void syncDossierToMemory(userId, profile?.id ?? null, extraction.fields);

    return res.json({ dossier: serializeDossier(saved) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to build your company file" });
  }
});

router.post("/dossier/:id/answers", requireAuth, async (req, res) => {
  const body = AnswersBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });

  try {
    const userId = requireUserId(req);
    const dossierId = Number(req.params.id);
    if (!Number.isFinite(dossierId)) return res.status(400).json({ error: "Invalid file id" });

    const updated = await saveDossierAnswers(userId, dossierId, body.data.answers);
    if (!updated) return res.status(404).json({ error: "That company file could not be found" });

    const extraction = readExtraction(updated);
    const fields = mergeAnswersIntoFields(extraction, readQuestions(updated), readAnswers(updated));
    void syncDossierToMemory(userId, updated.profileId, fields);

    return res.json({ dossier: serializeDossier(updated) });
  } catch (err) {
    req.log.error({ err }, "[dossier] answers save failed");
    return res.status(500).json({ error: `Couldn't save your answers — ${describeDbError(err)}` });
  }
});

// One short, honest clause about why a write failed, safe to show a founder.
// Postgres error codes are surfaced by name because the two that actually
// happen here are deployment problems (a table that was never created, a
// constraint that doesn't exist), and a generic message hides the one fact
// that would fix them in a minute.
function describeDbError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "42P01") return "the company_dossiers table doesn't exist in this database — run the schema push";
  if (code === "42P10" || code === "42703") return "this database's schema is out of date — run the schema push";
  if (code === "ECONNREFUSED" || code === "57P01") return "the database isn't reachable right now — try again in a moment";
  const message = err instanceof Error ? err.message : "";
  return message ? message.slice(0, 160) : "the database rejected the write";
}

// Writes the dossier's filled fields into the two stores the chat actually
// reads (the profile's context blob and company_facts), so intake answers
// change the next answer rather than sitting in their own silo.
async function syncDossierToMemory(
  userId: string,
  profileId: number | null,
  fields: { key: string; label: string; value: string | null }[],
): Promise<void> {
  try {
    const filled = fields.filter((f) => f.value);
    if (filled.length === 0) return;

    // The freeform profile blob is deliberately NOT written here. It used to
    // be overwritten with the dossier's fields, which — together with the
    // company_facts rows below and the dossier block itself — put the same
    // content into every prompt THREE times, in three shapes, on a budget
    // the static system prompt already consumes in full. Every duplicate
    // token is paid for by grounding material cut at the other end of a
    // shrink retry, so the redundancy was actively making answers worse.
    //
    // The blob keeps its own job: freeform context picked up from chat since
    // the file was last built. The dossier is read directly by /ai/analyze
    // (see the dossierBlock there), so nothing is lost by leaving it alone.
    for (const field of filled) {
      await addCompanyFact({
        userId,
        factText: `${field.label}: ${field.value}`,
        factType: field.key,
        sourceType: "onboarding",
        profileId,
      });
    }
  } catch (err) {
    console.error("[dossier] failed to sync into memory", err);
  }
}

// The monthly wrap. Computed on read rather than only by the cron job, so a
// founder opening this mid-month sees their month so far instead of an empty
// page until the 30th — the stored copy is still what freezes the numbers
// once the month is over (see persistMonthlyWrap).
router.get("/dossier/wrap", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const requested = typeof req.query.period === "string" && /^\d{4}-\d{2}$/.test(req.query.period)
      ? req.query.period
      : currentPeriodMonth(new Date());

    const groq = await getGroqClient(userId);
    const wrap = await buildMonthlyWrap(userId, requested, groq);

    // Only freeze a month that's actually over — persisting the current
    // month would lock in a partial picture that then never updates.
    if (requested !== currentPeriodMonth(new Date()) && wrap.hasSignal) {
      void persistMonthlyWrap(userId, wrap);
    }

    return res.json({ wrap, monthLabel: monthLabel(requested) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to build your monthly wrap" });
  }
});

export default router;
