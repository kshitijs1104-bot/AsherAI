import type { PrecedentMatch, RetrievalResult, OwnDecisionMatch } from "./retrieval";

// Confidence used to be a blind lookup on retrieval.tier (see the old
// ai.ts `parsed.confidence = retrieval.tier === "none" ? "exploratory" :
// "verified"` block this file replaces) — every "strong" AND "moderate"
// match landed "verified" with no distinction, and nothing about the
// founder's own resolved history or disagreement between matched
// precedents ever factored in. This computes a real 0-1 score from the
// actual evidence assembled for THIS response, so the badge reflects what
// was really used to ground the answer, not just which retrieval bucket it
// fell into.

export interface ConfidenceFactors {
  evidenceQuality: number;
  verificationBoost: number;
  contradictionPenalty: number;
  outcomeHistoryFactor: number;
}

export interface ContradictionSignal {
  description: string;
  precedentIds: number[];
}

export interface EvidenceRef {
  type: "precedent" | "own_decision";
  id: number;
  label: string;
  weight: number;
}

export interface ConfidenceResult {
  score: number;
  tier: "verified" | "exploratory";
  factors: ConfidenceFactors;
  contradictions: ContradictionSignal[];
  evidenceRefs: EvidenceRef[];
}

// The precedents table's default/unverified value — see
// lib/db/src/schema/precedents.ts. Every row in the current dataset is
// still this value (confirmed against data/precedents.json), so
// verificationBoost is a genuine, correct no-op today. It activates
// automatically the moment any row is manually verified — no further code
// change needed here.
const UNVERIFIED_STATUS = "auto-extracted-unverified";

// Bonus applied when at least one selected precedent has moved past the
// default unverified status. Small and additive, not a dominant factor —
// evidenceQuality (real topical match strength) still leads.
const VERIFICATION_BOOST_WEIGHT = 0.15;

// Caps how much a split (contradictory) precedent set can drag score down.
// A precedent set that's evenly split between success and failure outcomes
// for the same pattern is genuinely less trustworthy than a unanimous one,
// but shouldn't alone be able to zero out an otherwise strong lexical match.
const CONTRADICTION_MAX_PENALTY = 0.3;

// How much this founder's own resolved-decision track record can move the
// score, in either direction. Deliberately small relative to
// evidenceQuality — this reflects whether THIS founder's own history
// backs the pattern being reasoned about, not a global calibration signal.
const OUTCOME_HISTORY_WEIGHT = 0.15;

// First-pass calibration, not a derived constant. A clean "strong" tier
// match (score typically ~0.3-0.6+ from retrieval.ts's own thresholds)
// still clears this; a thin "moderate" match or a strong match dragged down
// by a real contradiction can now correctly fall to "exploratory" — which
// the old binary tier-lookup could never express. Revisit once
// confidenceFactors have accumulated in production logs.
const VERIFIED_THRESHOLD = 0.3;

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Real DB values are "failed" / "acquired" / "active" (see data/precedents.json)
// rather than the four-way enum the prompt asks the MODEL to use in its own
// precedent cards. Anything other than "failed" is treated as a
// positive/neutral outcome — this only needs to detect genuine disagreement,
// not classify outcomes precisely.
export function outcomePolarity(status: string): "negative" | "positive" {
  return status === "failed" ? "negative" : "positive";
}

function computeVerificationBoost(matches: PrecedentMatch[]): number {
  if (matches.length === 0) return 0;
  const verifiedCount = matches.filter((m) => m.precedent.verificationStatus !== UNVERIFIED_STATUS).length;
  return (verifiedCount / matches.length) * VERIFICATION_BOOST_WEIGHT;
}

// Detects disagreement within the precedent set actually grounding this
// response — the literal "detect conflicting signals ... surface the causal
// structure" requirement, applied to real retrieved evidence rather than
// asserted by the model.
function computeContradiction(matches: PrecedentMatch[]): { penalty: number; signal: ContradictionSignal | null } {
  if (matches.length < 2) return { penalty: 0, signal: null };

  const negative = matches.filter((m) => outcomePolarity(m.precedent.status) === "negative");
  const positive = matches.filter((m) => outcomePolarity(m.precedent.status) === "positive");

  if (negative.length === 0 || positive.length === 0) return { penalty: 0, signal: null };

  const minorityCount = Math.min(negative.length, positive.length);
  const penalty = (minorityCount / matches.length) * CONTRADICTION_MAX_PENALTY;

  const describe = (m: PrecedentMatch) => `${m.precedent.companyName} (${m.precedent.status})`;
  const signal: ContradictionSignal = {
    description: `Matched precedents disagree on outcome: ${positive.map(describe).join(", ")} vs. ${negative.map(describe).join(", ")}.`,
    precedentIds: matches.map((m) => m.precedent.id),
  };

  return { penalty, signal };
}

// This founder's own resolved decisions, scoped to the ones actually
// matched into this response (see retrieveOwnResolvedDecisions) — the
// "outcome history" input from the spec, honestly limited to what's
// actually trackable today rather than a fabricated global metric.
function computeOutcomeHistoryFactor(ownDecisions: OwnDecisionMatch[]): number {
  if (ownDecisions.length === 0) return 0;
  const positiveCount = ownDecisions.filter((d) => d.decision.outcomeSentiment === "positive").length;
  const negativeCount = ownDecisions.filter((d) => d.decision.outcomeSentiment === "negative").length;
  return ((positiveCount - negativeCount) / ownDecisions.length) * OUTCOME_HISTORY_WEIGHT;
}

function buildEvidenceRefs(citablePrecedents: PrecedentMatch[], ownDecisions: OwnDecisionMatch[]): EvidenceRef[] {
  const precedentRefs: EvidenceRef[] = citablePrecedents.map((m) => ({
    type: "precedent" as const,
    id: m.precedent.id,
    label: m.precedent.companyName,
    weight: m.score,
  }));
  const ownDecisionRefs: EvidenceRef[] = ownDecisions.map((d) => ({
    type: "own_decision",
    id: d.decision.id,
    label: d.decision.query.length > 80 ? `${d.decision.query.slice(0, 80)}…` : d.decision.query,
    weight: d.score,
  }));
  return [...precedentRefs, ...ownDecisionRefs];
}

export function computeConfidence(retrieval: RetrievalResult, ownDecisions: OwnDecisionMatch[]): ConfidenceResult {
  const evidenceQuality = clamp01(retrieval.confidence);
  const verificationBoost = computeVerificationBoost(retrieval.precedents);

  // FIX: contradiction detection and the "PRECEDENTS USED" citation list are
  // both user-facing claims about which specific companies back this
  // answer, so both are computed from the same, stricter "citable" set —
  // not every retrieved precedent regardless of tier, which is what let a
  // "moderate" match (retrieval.ts's own deliberately-relaxed pass, kept
  // loose so legitimate strategy questions don't lose all grounding — see
  // .agents/memory/retrieval-gating-lexical-overlap.md) get named in the UI
  // with the same visual confidence as a real match: "Spoke" was cited for
  // both an unrelated company-failure question and an unrelated Slack-draft
  // request; "Ask Jeeves"/"Notion AI" for a DTC coffee business.
  //
  // "strong" tier alone still isn't enough, though — confirmed live on
  // "which company do i own", a pure context-recall question with zero real
  // topical content of its own. retrieval.ts's base lexical score blends the
  // question with the founder's stored business context and deliberately
  // does NOT gate tier selection on questionOverlap (a prior attempt to do
  // that regressed real strategy questions — same memory note above), so a
  // question contributing nothing of its own can still ride stored context
  // to "strong" tier across precedents sharing nothing with what was
  // actually asked — that query cited Gigya/Piston Cloud/LendUp/SmartAsset
  // under a "Split precedent" badge, none related to the founder's business.
  // Per-precedent questionOverlap isn't blended away like the tier is, so
  // requiring it here (a citation-display filter, not a retrieval-scoring
  // one) closes this without touching retrieval.ts at all.
  const citablePrecedents = retrieval.tier === "strong" ? retrieval.precedents.filter((m) => m.questionOverlap > 0) : [];
  const { penalty: contradictionPenalty, signal } = computeContradiction(citablePrecedents);
  const outcomeHistoryFactor = computeOutcomeHistoryFactor(ownDecisions);

  const score = clamp01(evidenceQuality + verificationBoost - contradictionPenalty + outcomeHistoryFactor);
  // "Verified precedent" now additionally requires the STRONG retrieval tier,
  // not just a numeric score over the threshold. A moderate-tier match is,
  // by retrieval.ts's own definition, "a small or adjacent set of precedents
  // — a slightly thinner evidence base than a direct match", and the
  // user-facing confidenceNote already says exactly that. Labelling it
  // "Verified precedent" contradicted that note and was the overclaim behind
  // a fabricated answer shipping under a green verified badge: the score
  // cleared 0.3 purely on the +0.25 sector boost (see retrieval.ts). Adjacent
  // evidence is real evidence and still grounds the answer — it just isn't
  // "verified", so the badge now says exploratory and the note explains why.
  // Also requires at least one CITABLE precedent (real question relevance,
  // not just a context-blend-driven "strong" score) — without this, a
  // context-only strong match with zero question overlap and no
  // outcome-contradiction between its precedents (so no "Split precedent"
  // badge to at least hint something's off) could still claim "Verified
  // precedent" while citablePrecedents, and therefore evidenceRefs below,
  // is empty — a badge asserting grounding with nothing shown to back it.
  const tier: ConfidenceResult["tier"] =
    score >= VERIFIED_THRESHOLD && retrieval.tier === "strong" && citablePrecedents.length > 0 ? "verified" : "exploratory";

  return {
    score: Number(score.toFixed(3)),
    tier,
    factors: {
      evidenceQuality: Number(evidenceQuality.toFixed(3)),
      verificationBoost: Number(verificationBoost.toFixed(3)),
      contradictionPenalty: Number(contradictionPenalty.toFixed(3)),
      outcomeHistoryFactor: Number(outcomeHistoryFactor.toFixed(3)),
    },
    contradictions: signal ? [signal] : [],
    evidenceRefs: buildEvidenceRefs(citablePrecedents, ownDecisions),
  };
}
