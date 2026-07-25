import { db, precedentsTable, venusDecisionsTable, type Precedent, type VenusDecision } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export const SECTOR_KEYWORDS: Record<string, string[]> = {
  "SaaS/Enterprise Software": ["saas", "enterprise software", "b2b software", "dashboard", "crm", "collaboration tool", "productivity software"],
  "Fintech": ["fintech", "banking", "payments", "lending", "insurance tech", "insurtech", "trading", "crypto", "wallet", "neobank"],
  "Healthtech": ["healthtech", "health tech", "digital health", "medtech", "telemedicine", "biotech", "wellness app", "healthcare"],
  "Consumer Hardware": ["hardware", "wearable", "device", "gadget", "iot", "consumer electronics", "smart home"],
  "E-commerce/Retail": ["ecommerce", "e-commerce", "retail", "marketplace", "d2c", "online store", "subscription box"],
  "Foodtech": ["foodtech", "food tech", "delivery", "restaurant tech", "meal kit", "grocery", "food delivery"],
  "Edtech": ["edtech", "education tech", "e-learning", "online learning", "tutoring", "school software"],
  "AI/ML": ["ai", "artificial intelligence", "machine learning", "ml", "generative ai", "llm", "computer vision", "nlp"],
  "Mobility/Transportation": ["mobility", "transportation", "ride share", "rideshare", "autonomous vehicle", "ev", "scooter", "logistics", "delivery fleet"],
  "Real Estate/Proptech": ["proptech", "real estate", "property", "rental", "housing", "mortgage tech"],
  "Fitness/Wellness": ["gym", "fitness", "workout", "personal training", "wellness studio", "yoga studio", "crossfit", "membership fitness", "health club"],
};

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of", "in", "on", "for", "and", "or",
  "we", "our", "i", "my", "should", "would", "could", "what", "how", "do", "does", "will", "with", "about",
  "this", "that", "it", "its", "us", "me", "you", "your", "can", "if", "as", "at", "by", "from", "into",
  // Generic startup/business vocabulary that appears in nearly every precedent's
  // text — these carry no real topical signal and previously caused false-positive
  // matches on completely unrelated queries (e.g. a satellite-hardware query
  // matching a foodtech precedent purely because both mention "startup"/"raise").
  "startup", "startups", "company", "companies", "business", "businesses", "raise", "raising", "raised",
  "series", "funding", "fund", "funded", "product", "products", "market", "markets", "team", "teams",
  "build", "building", "built", "launch", "launching", "launched", "scale", "scaling", "scaled",
  "now", "need", "needs", "idea", "ideas", "operator", "operators", "founder", "founders", "money",
  "revenue", "growth", "grow", "growing", "customer", "customers", "year", "years",
]);

// Exported so other retrieval-shaped consumers (see messageLog.ts's
// getRelevantMessages, which scores raw chat history the same way this file
// scores precedents) can reuse the exact same tokenize/stopword logic
// instead of drifting out of sync with a second copy.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function inferSector(query: string): string | null {
  const lower = query.toLowerCase();
  let best: { sector: string; hits: number } | null = null;
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    const hits = keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { sector, hits };
    }
  }
  return best?.sector ?? null;
}

export interface PrecedentMatch {
  precedent: Precedent;
  score: number;
}

export type ConfidenceTier = "strong" | "moderate" | "none";

export interface RetrievalResult {
  matched: boolean;
  tier: ConfidenceTier;
  confidence: number;
  inferredSector: string | null;
  precedents: PrecedentMatch[];
  sectorCoverageCount: number;
}

const MATCH_THRESHOLD = 0.12;
const TOP_K = 4;
// Even if the ratio threshold is hit, require at least this many real overlapping
// substantive tokens (post-stopword) so a match can't be manufactured from a
// single coincidental word when the query has very few tokens overall.
const MIN_RAW_OVERLAP = 2;
// Strong tier requires this many solid in-sector-strength matches (see MATCH_THRESHOLD
// + MIN_RAW_OVERLAP above). Below that, we fall back to a relaxed "moderate" pass so a
// query is never hard-refused just because it doesn't clear the strict bar, as long as
// there is at least one genuinely overlapping real precedent to ground the answer in.
const STRONG_TIER_MIN_COUNT = 3;
// Moderate tier: real but weaker signal — fewer overlapping tokens and/or lower ratio,
// possibly from an adjacent/analogous sector. Still requires at least one real
// overlapping token; never zero-overlap (that would be pure fabrication).
const MODERATE_MATCH_THRESHOLD = 0.06;
const MODERATE_MIN_RAW_OVERLAP = 1;
const MODERATE_TOP_K = 3;

export async function retrievePrecedents(query: string, opts?: { sector?: string; businessContext?: string }): Promise<RetrievalResult> {
  let all: Precedent[];
  try {
    all = await db.select().from(precedentsTable);
  } catch (err) {
    // This is the same failure class already fixed for venus_decisions in
    // retrieveOwnResolvedDecisions below (missing table/migration, or the DB
    // connection being down for an unrelated reason) — but this call sits
    // earlier in /ai/analyze and runs unconditionally for every real
    // question, so leaving it unguarded meant ANY precedents-table hiccup
    // threw an uncaught rejection straight past retrieveOwnResolvedDecisions'
    // own protection and out to the route's top-level catch, turning into
    // the generic "couldn't answer that right now" fallback on every single
    // message — never reaching the isNone/web-search degradation path this
    // system already has for "no precedent data available." Log it and
    // degrade to "no precedent match" instead, exactly like a genuine
    // zero-match query already behaves.
    console.error("[retrievePrecedents] query failed, continuing with no precedent coverage (has the precedents table/migration been set up?)", err);
    return {
      matched: false,
      tier: "none",
      confidence: 0,
      inferredSector: opts?.sector || inferSector([query, opts?.businessContext].filter(Boolean).join(" ")),
      precedents: [],
      sectorCoverageCount: 0,
    };
  }

  const combinedQuery = [query, opts?.businessContext].filter(Boolean).join(" ");
  const queryTokens = new Set(tokenize(combinedQuery));
  // The founder's stored business context is deliberately part of the scoring
  // blend above (it's real signal about what they're asking *within*), but it
  // must never be able to manufacture a match ON ITS OWN. Tracked separately
  // here so the gates below can require that the ACTUAL QUESTION contributed
  // at least some real topical signal.
  //
  // Found live: a founder running an edtech business asked for a list of real
  // schools. The question's own tokens matched zero precedents, but the stored
  // business context ("edtech… schools…") inferred sector "Edtech" and every
  // Edtech precedent scored 0.306 — entirely from the +0.25 sector boost plus
  // one coincidental context token. That cleared the moderate gate, which
  // suppressed the web-search fallback and shipped a fabricated answer under a
  // "verified precedent" badge. The question itself had contributed nothing.
  const questionTokens = new Set(tokenize(query));
  const inferredSector = opts?.sector || inferSector(combinedQuery);
  const sectorCoverageCount = inferredSector ? all.filter((p: Precedent) => p.sector === inferredSector).length : 0;

  const scored: (PrecedentMatch & { overlap: number; questionOverlap: number })[] = all.map((p: Precedent) => {
    const haystack = [
      p.embeddingSummary,
      p.decisionContext,
      p.decisionTaken,
      p.causalMechanism,
      p.outcome,
      p.companyName,
      p.sector,
      ...(p.tags || []),
    ].join(" ");
    const docTokens = tokenize(haystack);
    const docTokenSet = new Set(docTokens);

    let overlap = 0;
    for (const t of queryTokens) {
      if (docTokenSet.has(t)) overlap++;
    }
    // How much of the overlap came from the founder's ACTUAL QUESTION rather
    // than their stored business context — see questionTokens above.
    let questionOverlap = 0;
    for (const t of questionTokens) {
      if (docTokenSet.has(t)) questionOverlap++;
    }
    const denom = Math.max(queryTokens.size, 1);
    let score = overlap / denom;

    // sector match is a strong signal on top of lexical overlap, but only
    // counts toward the raw-overlap floor if there is also at least some
    // genuine lexical overlap — otherwise a bare sector inference (from a
    // single loosely-matched keyword) could pass the gate with zero real
    // topical connection to the retrieved precedent's actual content.
    // Additionally requires the question itself to have contributed real
    // signal. Without this, a sector inferred purely from stored business
    // context hands +0.25 to every precedent in that sector — enough, on its
    // own, to clear the moderate gate for a question with zero topical
    // connection to any of them.
    if (inferredSector && p.sector === inferredSector && questionOverlap > 0) {
      score += 0.25;
    }
    // (questionOverlap === 0 → no boost: the sector was inferred from stored
    // business context alone, so boosting would rank precedents for a question
    // that never mentioned their subject. Ranking only — see the tier comment
    // below for why this is not used to reject matches outright.)

    return { precedent: p, score, overlap, questionOverlap };
  });

  scored.sort((a, b) => b.score - a.score);

  // NOTE: questionOverlap deliberately does NOT gate tier selection here.
  // Measured against the real dataset, requiring it caused a genuine
  // regression: "should we raise a seed round now" and "why is our churn
  // climbing" both dropped from moderate to none, losing their precedent
  // grounding entirely. Cause — the stopword list above already strips
  // "raise"/"funding"/"series"/"churn"-adjacent generic vocabulary, so a
  // legitimate in-domain strategy question can legitimately have near-zero
  // surviving content tokens, and gating on them punishes exactly the
  // causal-consultation questions this product exists to answer.
  //
  // Whether a question needs external grounding is not something lexical
  // overlap against startup case-studies can tell us — that judgment now
  // lives in lib/queryClassifier.ts, which forces a live web search and
  // source-grounding rules for factual lookups at ANY tier. This file's job
  // is only to rank precedents honestly; it is not the fabrication gate.
  const strongCandidates = scored.filter((s) => s.score >= MATCH_THRESHOLD && s.overlap >= MIN_RAW_OVERLAP);

  let tier: ConfidenceTier;
  let selected: (PrecedentMatch & { overlap: number; questionOverlap: number })[];

  if (strongCandidates.length >= STRONG_TIER_MIN_COUNT) {
    tier = "strong";
    selected = strongCandidates.slice(0, TOP_K);
  } else {
    // Relaxed pass: real precedents with weaker lexical signal and/or from an
    // adjacent sector, but still at least one genuinely overlapping token —
    // never a zero-overlap (pure sector-inference-only) match.
    //
    // If we confidently inferred a sector for this query, restrict the relaxed
    // pass to precedents in that same sector. Without this, a gym/fitness query
    // (a sector with zero or few precedents) could fall through and grab an
    // unrelated precedent (e.g. Ask Jeeves, Zume) purely because it shares one
    // generic overlapping word — a real match by the scoring math but with zero
    // genuine topical connection to the founder's actual question.
    const moderatePool = inferredSector
      ? scored.filter((s) => s.precedent.sector === inferredSector)
      : scored;
    const moderateCandidates = moderatePool.filter(
      (s) => s.score >= MODERATE_MATCH_THRESHOLD && s.overlap >= MODERATE_MIN_RAW_OVERLAP,
    );
    if (moderateCandidates.length > 0) {
      tier = "moderate";
      selected = moderateCandidates.slice(0, MODERATE_TOP_K);
    } else {
      tier = "none";
      selected = [];
    }
  }

  const top = selected.map(({ precedent, score }) => ({ precedent, score }));
  const confidence = top.length > 0 ? Math.min(1, top[0].score) : 0;
  const matched = tier !== "none";

  return {
    matched,
    tier,
    confidence: Number(confidence.toFixed(3)),
    inferredSector,
    precedents: top,
    sectorCoverageCount,
  };
}

export function formatPrecedentsForPrompt(matches: PrecedentMatch[]): string {
  return matches
    .map(
      (m, i) =>
        `[Precedent ${i + 1}] ${m.precedent.companyName} (${m.precedent.sector}, founded ${m.precedent.foundedYear ?? "?"}, status: ${m.precedent.status})\n` +
        `Context: ${m.precedent.decisionContext}\n` +
        `Decision: ${m.precedent.decisionTaken}\n` +
        `Causal mechanism: ${m.precedent.causalMechanism}\n` +
        `Outcome: ${m.precedent.outcome}${m.precedent.timeframeToOutcome ? ` (timeframe: ${m.precedent.timeframeToOutcome})` : ""}\n` +
        `Source: ${m.precedent.sourceCitation}`,
    )
    .join("\n\n");
}

/* ---- The founder's own resolved decisions — Venus's real, growing memory ---- */
//
// This is deliberately a SEPARATE, simpler retrieval path from
// retrievePrecedents above. The third-party precedent dataset is large
// enough to need real scoring/tiering/thresholds; a single founder's own
// decision history starts at zero and grows slowly, so simple recency +
// lexical overlap is sufficient and avoids over-engineering a tiny table.
// Critically, this is scoped to sessionId — one founder's resolved
// decisions are never surfaced into another founder's session.

export interface OwnDecisionMatch {
  decision: VenusDecision;
  score: number;
}

const OWN_DECISION_TOP_K = 3;

export async function retrieveOwnResolvedDecisions(
  sessionId: string,
  query: string,
  opts?: { businessContext?: string },
): Promise<OwnDecisionMatch[]> {
  let rows: VenusDecision[];
  try {
    rows = await db
      .select()
      .from(venusDecisionsTable)
      .where(and(eq(venusDecisionsTable.sessionId, sessionId), eq(venusDecisionsTable.status, "resolved")));
  } catch (err) {
    // This table is newly added and its migration may not have run yet in
    // every environment (or the connection may be down for an unrelated
    // reason). Retrieval here is a pure enhancement — the founder's own
    // history makes future answers better, but its absence must NEVER take
    // down the actual chat response, which is what happened before this
    // try/catch existed: a missing table turned into an uncaught rejection
    // that propagated all the way up to the generic "couldn't answer that
    // right now" fallback on every single message. Log it and degrade to
    // "no own-history available yet" instead.
    console.error("[retrieveOwnResolvedDecisions] query failed, continuing without own-history context (has the venus_decisions migration been run?)", err);
    return [];
  }

  if (rows.length === 0) return [];

  const combinedQuery = [query, opts?.businessContext].filter(Boolean).join(" ");
  const queryTokens = new Set(tokenize(combinedQuery));

  const scored: OwnDecisionMatch[] = rows.map((decision: VenusDecision) => {
    const haystack = [decision.query, decision.recommendationSummary, decision.outcome ?? "", decision.lesson ?? ""].join(" ");
    const docTokens = new Set(tokenize(haystack));
    let overlap = 0;
    for (const t of queryTokens) {
      if (docTokens.has(t)) overlap++;
    }
    // Recency counts here in a way it doesn't for the third-party precedent
    // dataset: a founder's own decision from last week is more relevant to
    // "what should I do now" than one from months ago, even at similar topical
    // overlap, since it reflects the current state of their business.
    const ageDays = decision.resolvedAt ? (Date.now() - new Date(decision.resolvedAt).getTime()) / 86_400_000 : 9999;
    const recencyBoost = ageDays < 30 ? 0.15 : ageDays < 90 ? 0.05 : 0;
    const score = overlap / Math.max(queryTokens.size, 1) + recencyBoost;
    return { decision, score };
  });

  return scored
    .filter((s) => s.score > 0) // never surface a zero-overlap decision just to fill the slot
    .sort((a, b) => b.score - a.score)
    .slice(0, OWN_DECISION_TOP_K);
}

export function formatOwnDecisionsForPrompt(matches: OwnDecisionMatch[]): string {
  if (matches.length === 0) return "";
  return matches
    .map(
      (m, i) =>
        `[Your own past decision ${i + 1}] Asked: "${m.decision.query}"\n` +
        `You recommended: ${m.decision.recommendationSummary}\n` +
        `What actually happened: ${m.decision.outcome}\n` +
        `Lesson: ${m.decision.lesson ?? "(not yet derived)"}`,
    )
    .join("\n\n");
}

// ---- Same-session OPEN decision reconciliation ----
//
// retrieveOwnResolvedDecisions above only surfaces a decision once the
// founder has reported back a real outcome — right for cross-session
// precedent, but it means a decision Venus made 90 seconds ago in the SAME
// live conversation never gets checked against a follow-up that revises
// the numbers, because it can't possibly be "resolved" yet. That gap is
// exactly what let Venus flip from "50L for 5% equity is best" to "1cr for
// 5% is best" two messages later with zero acknowledgment it said the
// first thing — same session, same decision, no reconciliation.
//
// This retrieves OPEN decisions for this sessionId (sessionId is actually
// the founder's persistent userId — see venus_decisions schema comments —
// so it is NOT scoped to one chat thread on its own), restricted to a
// short recency window so it only catches genuinely live back-and-forth
// rather than resurfacing an unrelated decision left open for weeks.
// Deliberately no topical/lexical filtering beyond that window: a false
// positive here just means the model sees one extra "earlier this
// session" block it correctly ignores as unrelated (see the groq.ts
// instruction this feeds); a false negative means the exact flip-flop bug
// this exists to catch goes uncaught. Recency + a small top-K keeps the
// cost of the former low.
const OPEN_SESSION_DECISION_TOP_K = 2;
const OPEN_SESSION_DECISION_WINDOW_MS = 45 * 60_000;

export async function retrieveOpenSessionDecisions(sessionId: string): Promise<VenusDecision[]> {
  let rows: VenusDecision[];
  try {
    rows = await db
      .select()
      .from(venusDecisionsTable)
      .where(and(eq(venusDecisionsTable.sessionId, sessionId), eq(venusDecisionsTable.status, "open")));
  } catch (err) {
    // Same failure philosophy as retrieveOwnResolvedDecisions above — this
    // is a pure enhancement and must never take down the actual chat
    // response if the table/migration isn't there yet.
    console.error("[retrieveOpenSessionDecisions] query failed, continuing without same-session reconciliation (has the venus_decisions migration been run?)", err);
    return [];
  }

  if (rows.length === 0) return [];

  const now = Date.now();
  return rows
    .filter((r) => r.createdAt && now - new Date(r.createdAt).getTime() <= OPEN_SESSION_DECISION_WINDOW_MS)
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, OPEN_SESSION_DECISION_TOP_K);
}

export function formatOpenSessionDecisionsForPrompt(decisions: VenusDecision[]): string {
  if (decisions.length === 0) return "";
  return decisions
    .map((d) => {
      const ageMin = d.createdAt ? Math.round((Date.now() - new Date(d.createdAt).getTime()) / 60_000) : null;
      const ageLabel = ageMin !== null ? `${ageMin} min ago` : "earlier this session";
      return `[Open recommendation, ${ageLabel}] Asked: "${d.query}"\nYou recommended: ${d.recommendationSummary}`;
    })
    .join("\n\n");
}