import { db, companyFactsTable, type CompanyFact } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { tokenize } from "./retrieval";

// Service layer for the structured Company Memory table (see
// lib/db/src/schema/company_facts.ts for why this exists alongside
// settings.venusBusinessContext rather than replacing it outright, and for
// the entryKind/claimType/deletedAt columns this file now reads/writes).
// Every function here is best-effort: a failure must never break the chat
// response it's attached to, mirroring the try/catch philosophy already
// established in retrieval.ts and autoLogDecisionCards.

export interface AddCompanyFactInput {
  userId: string;
  factText: string;
  factType?: string; // general | constraint | milestone | market | team | metric
  entryKind?: "business_fact" | "preference" | "decision_note";
  claimType?: "style_preference" | "user_reported_belief" | "verified";
  sourceType: "onboarding" | "chat" | "checkin" | "decision" | "manual";
  confidence?: number;
  // Which business_profiles row this fact belongs to (see
  // businessProfiles.ts). Only meaningful for entryKind "business_fact" —
  // pass null/omit for preferences, which apply across every business a
  // founder has.
  profileId?: number | null;
}

export async function addCompanyFact(input: AddCompanyFactInput): Promise<CompanyFact | null> {
  const trimmed = input.factText.trim();
  if (!trimmed) return null;
  try {
    const [row] = await db
      .insert(companyFactsTable)
      .values({
        userId: input.userId,
        factText: trimmed,
        factType: input.factType || "general",
        entryKind: input.entryKind || "business_fact",
        claimType: input.claimType || "user_reported_belief",
        sourceType: input.sourceType,
        confidence: input.confidence ?? null,
        profileId: input.profileId ?? null,
      })
      .returning();
    return row ?? null;
  } catch (err) {
    console.error("[companyMemory] failed to add fact", err);
    return null;
  }
}

// Active = not yet superseded by a later, corrected statement, and not
// explicitly deleted by the founder. Ordered most recent first so a
// prompt-context caller taking a top-N slice gets the freshest facts rather
// than an arbitrary insertion-order slice.
//
// profileId scopes this to ONE business (see businessProfiles.ts) — without
// it, a founder with 2-3 businesses would get every business's facts blended
// into one prompt regardless of which one the current chat is actually
// about. Omitted/null falls back to the pre-multi-profile behavior (every
// business_fact row for this user) so a caller that hasn't looked up an
// active profile yet still degrades to something reasonable rather than
// silently returning nothing.
export async function getActiveCompanyFacts(userId: string, limit = 20, profileId?: number | null): Promise<CompanyFact[]> {
  try {
    const conditions = [
      eq(companyFactsTable.userId, userId),
      isNull(companyFactsTable.supersededBy),
      isNull(companyFactsTable.deletedAt),
      eq(companyFactsTable.entryKind, "business_fact"),
    ];
    if (profileId != null) conditions.push(eq(companyFactsTable.profileId, profileId));
    return await db
      .select()
      .from(companyFactsTable)
      .where(and(...conditions))
      .orderBy(desc(companyFactsTable.createdAt))
      .limit(limit);
  } catch (err) {
    console.error("[companyMemory] failed to load active facts, degrading to empty", err);
    return [];
  }
}

// Standing preferences ("no em-dashes", "keep answers short") are a SEPARATE
// pull from ordinary business facts above: a style rule must apply to every
// future task regardless of topic, so this is never subject to the
// topic-relevance filtering ai.ts applies to the business-fact block (see
// getRelevantMessages in messageLog.ts for that filtering, which deliberately
// does NOT apply here). Capped at a small number since a founder should only
// ever have a handful of live standing preferences, not dozens.
export async function getActivePreferenceFacts(userId: string, limit = 10): Promise<CompanyFact[]> {
  try {
    return await db
      .select()
      .from(companyFactsTable)
      .where(and(
        eq(companyFactsTable.userId, userId),
        isNull(companyFactsTable.supersededBy),
        isNull(companyFactsTable.deletedAt),
        eq(companyFactsTable.entryKind, "preference"),
      ))
      .orderBy(desc(companyFactsTable.createdAt))
      .limit(limit);
  } catch (err) {
    console.error("[companyMemory] failed to load active preference facts, degrading to empty", err);
    return [];
  }
}

// Records a corrected/updated fact WITHOUT deleting or blindly appending to
// the old one — inserts the new fact, then points the old row's
// supersededBy at it, so a `supersededBy IS NULL` filter always reflects
// current ground truth and the superseded claim stays queryable as history
// rather than vanishing or lingering as a live contradiction.
export async function supersedeFact(
  oldFactId: number,
  replacement: Omit<AddCompanyFactInput, "userId"> & { userId: string },
): Promise<CompanyFact | null> {
  try {
    const newFact = await addCompanyFact(replacement);
    if (!newFact) return null;
    await db
      .update(companyFactsTable)
      .set({ supersededBy: newFact.id, updatedAt: new Date() })
      .where(eq(companyFactsTable.id, oldFactId));
    return newFact;
  } catch (err) {
    console.error("[companyMemory] failed to supersede fact", err);
    return null;
  }
}

// Explicit founder-initiated removal (the "What Vera has learned" delete
// action) — soft delete via deletedAt, scoped to userId so one founder can
// never delete another's row. Idempotent: deleting an already-deleted row is
// a no-op success (still returns true), not an error.
export async function deleteCompanyFact(userId: string, factId: number): Promise<boolean> {
  try {
    const [existing] = await db
      .select({ id: companyFactsTable.id })
      .from(companyFactsTable)
      .where(and(eq(companyFactsTable.id, factId), eq(companyFactsTable.userId, userId)))
      .limit(1);
    if (!existing) return false;
    await db
      .update(companyFactsTable)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(companyFactsTable.id, factId));
    return true;
  } catch (err) {
    console.error("[companyMemory] failed to delete fact", err);
    return false;
  }
}

// Cheap negation/contradiction markers checked between the new statement and
// an existing fact that already shares real subject-matter overlap with it
// (see findPotentialContradiction below) — deliberately narrow rather than a
// general sentiment/entailment model, same philosophy as every other
// regex-based classifier in this codebase (isPureContextStatement,
// looksLikeDifferentBusiness, etc.).
const NEGATION_MARKERS = /\b(not|no longer|isn'?t|aren'?t|stopped|pivoted away|instead of|rather than|actually we|used to|previously)\b/i;
// A bare number (with optional currency/percent) — used to catch "we do
// $10K MRR" vs a later "we do $40K MRR" even with no explicit negation word.
const NUMERIC_CLAIM = /[\$₹€£]?\s?\d[\d,]*(\.\d+)?\s?%?/g;

function extractNumbers(text: string): string[] {
  return (text.match(NUMERIC_CLAIM) ?? []).map((s) => s.replace(/\s+/g, ""));
}

// Looks for an ACTIVE fact of the same factType whose subject clearly
// overlaps the new statement (shares ≥2 real non-stopword tokens — same
// floor as retrieval.ts's MIN_RAW_OVERLAP) but whose actual content differs
// in a way that reads as a correction rather than an elaboration: either an
// explicit negation/change marker relative to the stored text, or a
// different stated number where the old fact also had one. Returns the
// closest such fact, or null if nothing looks like a genuine contradiction —
// this is a conservative pre-filter (false negatives just mean the founder
// isn't asked and the fact is added normally; the cost of over-triggering
// this on ordinary elaboration would be worse, since it would nag the
// founder on every new detail about the same subject).
//
// profileId scopes candidates to ONE business — without it, mentioning a
// detail about business B could get flagged as "contradicting" a fact from
// unrelated business A purely because both use generic overlapping words.
export async function findPotentialContradiction(
  userId: string,
  factType: string,
  newFactText: string,
  profileId?: number | null,
): Promise<CompanyFact | null> {
  try {
    const conditions = [
      eq(companyFactsTable.userId, userId),
      eq(companyFactsTable.factType, factType),
      eq(companyFactsTable.entryKind, "business_fact"),
      isNull(companyFactsTable.supersededBy),
      isNull(companyFactsTable.deletedAt),
    ];
    if (profileId != null) conditions.push(eq(companyFactsTable.profileId, profileId));
    const candidates = await db
      .select()
      .from(companyFactsTable)
      .where(and(...conditions))
      .orderBy(desc(companyFactsTable.createdAt))
      .limit(20);

    if (candidates.length === 0) return null;

    const newTokens = new Set(tokenize(newFactText));
    const newNumbers = new Set(extractNumbers(newFactText));
    const hasNegation = NEGATION_MARKERS.test(newFactText);

    for (const fact of candidates) {
      const oldTokens = new Set(tokenize(fact.factText));
      let overlap = 0;
      newTokens.forEach((t) => { if (oldTokens.has(t)) overlap++; });
      if (overlap < 2) continue; // not even the same subject — not a contradiction candidate

      const oldNumbers = extractNumbers(fact.factText);
      const numbersDiffer = oldNumbers.length > 0 && newNumbers.size > 0
        && !oldNumbers.some((n) => newNumbers.has(n));

      if (hasNegation || numbersDiffer) {
        return fact;
      }
    }
    return null;
  } catch (err) {
    console.error("[companyMemory] failed to check for contradiction, skipping check", err);
    return null;
  }
}

// ---- Business-context blob merging ----
//
// The blob (settings/business_profiles' contextBlob) was grown by literal
// string concatenation — `${stored} | ${newMessage}` — at every call site,
// with no cap, no dedupe, and nothing ever removed. It is injected into
// EVERY prompt as the "Business Context:" line, so on a long-lived account
// it grows without bound against a token budget the static system prompt
// already exhausts by itself (see groq.ts's TPM math). Two consequences,
// both bad and both silent: requests get shrink-retried, which cuts real
// grounding material; and context the founder corrected months ago keeps
// being replayed forever alongside the correction, so Vera reasons from
// both at once.
//
// Bounded, deduped, newest-first-preserved merging fixes both. Superseding
// individual claims is company_facts' job (see supersedeFact above) — this
// only stops the freeform blob from becoming an ever-growing transcript.
const MAX_CONTEXT_BLOB_CHARS = 1500;
const CONTEXT_SEGMENT_SEPARATOR = " | ";

export function mergeContextBlob(stored: string | undefined, addition: string): string {
  const clean = addition.trim();
  const existing = (stored ?? "")
    .split(CONTEXT_SEGMENT_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);

  // Case-insensitive exact-duplicate drop. Deliberately not fuzzy: a
  // near-duplicate that adds one new number is genuinely new information,
  // and dropping it would lose the update this merge exists to record.
  const seen = new Set<string>();
  const ordered: string[] = [];
  // Newest first while filling the budget, so the oldest segments are the
  // ones that fall off the end rather than the freshest.
  for (const segment of [clean, ...existing.reverse()]) {
    if (!segment) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(segment);
  }

  const kept: string[] = [];
  let total = 0;
  for (const segment of ordered) {
    const cost = segment.length + CONTEXT_SEGMENT_SEPARATOR.length;
    if (kept.length > 0 && total + cost > MAX_CONTEXT_BLOB_CHARS) break;
    kept.push(segment);
    total += cost;
  }

  // Restored to chronological order so the blob still reads as a history
  // rather than a reversed one; the newest segment is simply guaranteed to
  // have survived the budget.
  return kept.reverse().join(CONTEXT_SEGMENT_SEPARATOR);
}

export function formatCompanyFactsForPrompt(facts: CompanyFact[]): string {
  if (facts.length === 0) return "";
  // A user_reported_belief fact is the founder's own claim about themselves —
  // reasoned from, never restated back as independently established truth
  // (see the matching instruction line in groq.ts's VENUS_SYSTEM_PROMPT).
  // "verified" is unused today (nothing in this system verifies a claim
  // against an outside source yet) but rendered plainly if it's ever set.
  return facts
    .map((f) => {
      const tierLabel = f.claimType === "verified" ? "verified" : "user-reported";
      return `- [${f.factType}, ${tierLabel}] ${f.factText}`;
    })
    .join("\n");
}

export function formatPreferenceFactsForPrompt(facts: CompanyFact[]): string {
  if (facts.length === 0) return "";
  return facts.map((f) => `- ${f.factText}`).join("\n");
}
