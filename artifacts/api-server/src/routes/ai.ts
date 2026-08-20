import { Router } from "express";
import { db, settingsTable, venusDecisionsTable, goalsTable, type VenusDecision, type BusinessProfile } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { VenusAnalyzeBody, IdeaReviewBody } from "@workspace/api-zod";
import { needsCrisisResponse, buildCrisisResponse, looksLikeModelSafetyRefusal } from "../lib/crisisSupport";
import { getGroqClient, VENUS_PROMPT, buildVenusPrompt, type VenusResponseMode, buildFallbackVenusResponse, buildTransientErrorResponse, callGroqJSON, isContentPolicyRefusal, isQuotaExhaustedError, quotaRetryAfterMs, MODERATE_TIER_PRECEDENT_NOTE, EXTRACTED_FACTS_INSTRUCTION, EVIDENCE_CONVERGENCE_INSTRUCTION, sanitizeVenusResponse, estimateTokens, tpmLimitForModel, TPM_SAFETY_MARGIN, MIN_USABLE_MAX_TOKENS, buildGroundingInstructions } from "../lib/groq";
import { retrievePrecedents, formatPrecedentsForPrompt, retrieveOwnResolvedDecisions, formatOwnDecisionsForPrompt, retrieveOpenSessionDecisions, formatOpenSessionDecisionsForPrompt, type RetrievalResult } from "../lib/retrieval";
import { computeConfidence } from "../lib/confidence";
import { detectFactConflicts, type ExtractedFact } from "../lib/factConflicts";
import { computeConvergence, withheldReasonFor, generateRecommendationText, type Hypothesis, type Contradiction } from "../lib/evidenceConvergence";
import { collectResponseStrings } from "../lib/responseText";
import { checkArithmeticConsistency } from "../lib/arithmeticCheck";
import { detectUngroundedCurrency, detectUngroundedEntityClaims } from "../lib/groundedness";
import { webSearch, formatWebSearchForPrompt } from "../lib/websearch";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { applyResolvedEvidence } from "../lib/goalEvidence";
import { classifyDecisionType, archiveStaleOpenDecisions } from "../lib/decisionMemory";
import { materializeRoadmapFromCard } from "../lib/roadmap";
import { addCompanyFact, getActiveCompanyFacts, getActivePreferenceFacts, formatCompanyFactsForPrompt, formatPreferenceFactsForPrompt, findPotentialContradiction, supersedeFact, mergeContextBlob } from "../lib/companyMemory";
import { getOrCreateActiveProfile, findMatchingProfile, createProfile, setActiveProfile, updateProfileContext } from "../lib/businessProfiles";
import { logMessage, getRelevantMessages, getRecentMessages } from "../lib/messageLog";
import { buildCrossChatMemory, ensureChatSummary, looksLikeRecallQuestion } from "../lib/chatMemory";
import { buildAttachmentBlock, parseAttachmentMarkers } from "../lib/attachmentContext";
import { getDossier, formatDossierForPrompt } from "../lib/dossier";
import {
  looksLikeCorrection,
  looksLikeGeneralizablePreference,
  confirmPreferenceWithModel,
  looksLikeExistingPreference,
  enforceStylePreferences,
} from "../lib/preferenceDetection";
import { parseLengthConstraint, verifyLengthConstraint, describeLengthConstraint } from "../lib/lengthConstraint";
import { classifyQuery } from "../lib/queryClassifier";
import { looksLikeReplyToPriorTurn, buildCorrectionInstruction, type ReplyDetectionSource } from "../lib/turnIntent";
import { recordCorrection, getRecentCorrections, formatCorrectionsForPrompt } from "../lib/responseFeedback";

const router = Router();

// The model every Venus reasoning call in this file runs on. Was four
// separate string literals, which is precisely the drift hazard this repo
// has already been bitten by twice (see groq.ts's migration comments) — and
// one of those literals fed tpmLimitForModel, so a partial rename would have
// silently budgeted against a model the request wasn't using.
const ANALYZE_MODEL = "openai/gpt-oss-120b";

// Shared by every route's outer catch block: classifies a caught Groq
// error into the "kind"/"retryAfterMs" pair buildTransientErrorResponse
// needs to surface an honest message — a daily-quota 429 gets its real
// wait time (see isQuotaExhaustedError/quotaRetryAfterMs in groq.ts),
// never a hardcoded guess.
function classifyGroqError(err: any): { kind: "policy" | "quota" | undefined; retryAfterMs: number | null } {
  if (isContentPolicyRefusal(err)) return { kind: "policy", retryAfterMs: null };
  if (isQuotaExhaustedError(err)) return { kind: "quota", retryAfterMs: quotaRetryAfterMs(err) };
  return { kind: undefined, retryAfterMs: null };
}

// Fetches the active goal (if any) for the chat this message belongs to and
// renders it as the block that goes into the system prompt — the mechanism
// that makes a Goal actually change how Venus answers, the same way a Claude
// Project's custom instructions frame every message inside that project.
// Deliberately only fires for "active" goals: a completed/abandoned goal
// shouldn't keep pressuring every future message in a chat someone's still
// using for something else. Returns "" (not undefined) when there's no
// chatId, no goal, or the goal isn't active, so callers can always safely
// interpolate the result directly into the prompt template.
async function buildGoalPromptBlock(chatId: number | undefined): Promise<string> {
  if (!chatId) return "";
  try {
    const [goal] = await db
      .select()
      .from(goalsTable)
      .where(and(eq(goalsTable.chatId, chatId), eq(goalsTable.status, "active")))
      .limit(1);
    if (!goal) return "";

    const daysToDeadline = Math.ceil((goal.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const deadlineLine = daysToDeadline < 0
      ? `deadline was ${Math.abs(daysToDeadline)} day(s) ago — this goal is overdue`
      : `${daysToDeadline} day(s) until deadline`;

    return `THIS CHAT'S GOAL (set by the founder like a Project's custom instructions — every answer in this chat should be read through this lens, weighing urgency, expected value, and trade-offs against it; this is not a topic restriction, the founder can still ask unrelated things, but when relevant, reason explicitly about how the current question moves toward or away from this goal):\n"${goal.title}"\nSuccess metric (the concrete win condition): ${goal.successMetric}\nValue if hit: ₹${goal.valueInr.toLocaleString("en-IN")}\nDeadline: ${goal.deadline.toISOString().slice(0, 10)} (${deadlineLine})`;
  } catch {
    // Never let a goal-lookup failure break the actual chat response.
    return "";
  }
}

// Cross-chat track record — deliberately separate from buildGoalPromptBlock
// above, which only ever surfaces the ACTIVE goal for the CURRENT chat.
// This is the piece that was actually missing for real learning: individual
// decision outcomes were already retrievable (see retrieveOwnResolvedDecisions),
// but whether a founder's past GOALS landed or not never fed back into
// future answers at all — Venus could recommend the same shape of plan that
// already failed once, with zero memory that it had. Capped at a handful of
// short lines (not full goal detail) to keep this a cheap, bounded addition
// rather than another full retrieval pass.
const GOAL_HISTORY_LIMIT = 5;

async function buildGoalHistoryBlock(userId: string): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(goalsTable)
      .where(and(eq(goalsTable.userId, userId), inArray(goalsTable.status, ["completed", "abandoned"])))
      .orderBy(desc(goalsTable.resolvedAt))
      .limit(GOAL_HISTORY_LIMIT);
    if (rows.length === 0) return "";

    const lines = rows.map((g) => {
      const outcome = g.status === "completed" ? "COMPLETED" : "ABANDONED";
      return `- [${outcome}] "${g.title}" (target: ${g.successMetric}) — final evidence score ${g.evidenceScore.toFixed(2)}`;
    });
    return `THIS FOUNDER'S GOAL TRACK RECORD (across all their chats — use this to avoid proposing a plan shape that already failed, and to recognize an approach that already worked):\n${lines.join("\n")}`;
  } catch {
    // Never let a track-record lookup failure break the actual chat response.
    return "";
  }
}

function normalizeQueryText(message: string) {
  return message.toLowerCase().replace(/[^a-z0-9\s?]/g, " ").replace(/\s+/g, " ").trim();
}

// normalizeQueryText strips apostrophes down to a bare space rather than
// removing them, so "it's"/"isn't"/"don't" survive as "it s"/"isn t"/"don t"
// — two tokens, not one. The short yes/no-style classifiers below need to
// match these as single words, so re-join the common ones before running
// any keyword checks against normalized text.
function rejoinContractions(normalized: string): string {
  return normalized
    .replace(/\bit\s+s\b/g, "its")
    .replace(/\bisn\s+t\b/g, "isnt")
    .replace(/\bdoesn\s+t\b/g, "doesnt")
    .replace(/\bdon\s+t\b/g, "dont")
    .replace(/\bthat\s+s\b/g, "thats")
    .replace(/\bwhat\s+s\b/g, "whats");
}

// A specific number proposed inside a category that has real benchmark
// alternatives (pricing, equity/valuation/dilution, a VC raise, a budget
// split) is a comparison question even when the founder states only one
// value and never says "or"/"vs" — "should I price at 500rs" and "1cr for
// 5%, thoughts?" are both really asking "is this number right," which only
// has a real answer relative to alternatives Venus generates itself. Before
// this, those got classified "binary" and routed to "just give a verdict,"
// which is exactly what let Venus validate whatever number the founder
// happened to type rather than comparing it to anything.
const BENCHMARKABLE_CATEGORY = /\b(price|pricing|priced|subscription|fee|fees|charge|charges|equity|valuation|dilution|vc|investor|investors|funding|raise|cap ?table|budget|allocation|split|spend|invest|salary|payout)\b/;

// A question asking WHY something is happening, or naming a problem to
// diagnose, is not a request to pick between options — even when it also
// contains an incidental decision-ish verb ("should I be worried my churn is
// climbing" reads as decision-ish on "should" alone, but it's a diagnosis
// question) or a number/benchmarkable word ("why did my $500 ad spend not
// convert" hits both hasNumericValue and BENCHMARKABLE_CATEGORY on "spend").
// Before this exclusion, both of those forced single-value-benchmark or
// binary decision routing — instructing the model to generate benchmark
// alternatives and score them, or to lead with a verdict word — on a
// question that has nothing to compare, which is exactly what was producing
// comparison-style cards on plain diagnostic questions. See groq.ts's "IS
// THIS ACTUALLY A COMPARISON?" prompt section for the model-side half of
// this fix; this is the code-side half that stops the forced instruction
// from ever reaching the prompt in the first place.
const DIAGNOSTIC_QUESTION = /\b(why|what'?s (causing|wrong|broken|happening|going on)|whats (causing|wrong|broken|happening|going on)|stalling|stalled|stuck|struggling|isn'?t (working|converting|growing|selling)|not (working|converting|growing|selling)|declin(ing|ed)|dropp(ing|ed)|falling|slipping)\b/i;

// REMOVED: FACTUAL_EXTERNAL_QUERY, a regex that enumerated phrasings
// ("reviews of", "compare to", "latest news on") to decide whether a question
// needed a live web search. It could never cover the unbounded space of real
// user phrasings — "give me a list of real schools in Mumbai" matched none of
// its alternatives, so the query was treated as strategy, never searched, and
// answered with invented institutions. Replaced by lib/queryClassifier.ts,
// which classifies what the question actually needs instead of pattern-
// matching how it happens to be worded.

function inferDecisionRouting(message: string) {
  const normalized = normalizeQueryText(message);
  if (!normalized) return null;

  const isDecisionish = /\b(should|shld|would|could|worth|hire|wait|launch|buy|build|raise|bootstrap|outsource|do|use|join|go|stick|keep)\b/.test(normalized);
  const hasAlternatives = /\b(or|vs|versus|instead|rather|either)\b/.test(normalized) || normalized.includes(" or ");
  const hasNumericValue = /\d/.test(normalized);
  const isBenchmarkable = BENCHMARKABLE_CATEGORY.test(normalized);
  const isDiagnostic = DIAGNOSTIC_QUESTION.test(normalized);

  // Explicit alternatives ("A or B") are a real comparison regardless of
  // diagnostic-sounding phrasing elsewhere in the message — this check stays
  // first and always wins.
  if (hasAlternatives) {
    return { mode: "decision" as const, subtype: "multi-option" as const };
  }
  // No explicit alternatives AND it reads as a "why"/diagnosis question →
  // there's nothing to compare yet; let it fall through to normal
  // evidence-first reasoning instead of forcing decision-card framing.
  if (isDiagnostic) return null;
  if (hasNumericValue && isBenchmarkable) {
    return { mode: "decision" as const, subtype: "single-value-benchmark" as const };
  }
  if (!isDecisionish) return null;

  return {
    mode: "decision" as const,
    subtype: "binary" as const,
  };
}

function buildDecisionRoutingInstruction(message: string) {
  const routing = inferDecisionRouting(message);
  if (!routing) return "";

  if (routing.subtype === "single-value-benchmark") {
    return `Query routing: The founder proposed one number (price, equity, valuation, budget split) and asks if it's right. Do NOT just validate it — silently generate 2 realistic benchmark alternatives for this decision, then compare the founder's number against them in prose in "summary" first (which wins, and why); only if useful, reflect that in a decision card (reasoning per option, scores optional). If your comparison still lands on the founder's number, say why it beat the alternatives — agreement must be earned, not default.`;
  }

  const noun = routing.subtype === "multi-option" ? "multi-option decision question" : "single-path decision question";
  return `Query routing: This is a ${noun} even if short or fragmentary — answer directly with a clear verdict and reasoning in prose, no rephrasing fallback. Decision card only if genuinely multiple viable paths; a single-path/binary call needs none.`;
}

// ---- Query scope classification (prompt-size routing) ----
//
// WHY THIS EXISTS: without it, every message — including a two-word
// clarification like "what's a SAM?" or "what did you mean by that" — gets
// assembled into the exact same system prompt as a full "help me decide
// whether to raise a seed round" question: full 8-turn history, up to 4
// third-party precedents (each a dense multi-field block), up to 3 of the
// founder's own resolved decisions, and (when no precedent matches) a full
// web search block. On a real account that's ~6000+ tokens of prompt before
// the model writes a single token back. That's not just slow — on a
// constrained TPM budget it forces callGroqJSON's clampMaxTokensToTpmBudget
// to shrink max_tokens so far that the multi-card JSON response gets
// truncated, which is what was producing the empty/stub cards and the
// 30-60s multi-retry latency in production logs. Shrinking the prompt for
// the (common) case where the question doesn't need all of that context is
// the actual fix — it helps on every provider and every tier, not just the
// free one.
//
// This is deliberately a narrow/broad classification, not a fine-grained
// token budget calculator — cheap regex heuristics, same style as
// inferDecisionRouting and isPureContextStatement above. Ambiguous cases
// default to "broad" (the existing, unchanged behavior) so this can only
// ever shrink prompts it's confident don't need the full context; it can
// never accidentally starve a question that does.
export type QueryScope = "narrow" | "broad";

// Cheap signal that a message is a plain definition/clarification ask with
// no personal business framing — "what's a SAM?", "what does CAC mean",
// "explain runway". Reuses the same what-is/define/explain pattern already
// established by isSimpleDefinition's logic further up this file, kept
// separate here since scope classification needs to run standalone (a
// narrow message might not even reach requiresContext's call site).
//
// IMPORTANT: this is matched against normalizeQueryText's OUTPUT, not the
// raw message — normalizeQueryText strips apostrophes to a bare space
// rather than deleting them entirely (see its regex above), so "what's"
// becomes "what s", not "whats". The pattern below is written to match that
// actual normalized form. Also matches "what does X mean" — normalizeQueryText
// already strips filler stopwords nowhere in its own logic, so "does" is
// still present in the normalized string and must be handled explicitly
// rather than assumed away.
const DEFINITION_ASK = /^(what\s?('?s|\s+is|\s+does)|define|explain|meaning of|difference between)\b/i;

// Narrow follow-up phrasing: refers back to "that/it/this" or explicitly
// says "the one you mentioned" etc., rather than introducing a new topic.
const FOLLOW_UP_REFERENCE = /\b(that|it|this|the one|the above|earlier|previous|last (one|answer|point|card))\b/i;

function classifyQueryScope(
  message: string,
  sessionHistory?: { role?: string; content?: string }[],
): QueryScope {
  const normalized = normalizeQueryText(message);
  if (!normalized) return "broad";

  const wordCount = normalized.split(" ").filter(Boolean).length;
  const hasHistory = Boolean(sessionHistory && sessionHistory.length > 0);

  // A plain definition/clarification question is narrow regardless of
  // history — it's asking Venus to explain a term or concept, not to
  // reason over the founder's precedent/decision context.
  if (DEFINITION_ASK.test(normalized) && wordCount <= 12) return "narrow";

  // A short message that explicitly references "that/it/this" AND there is
  // prior conversation to refer back to is a narrow follow-up — answering
  // it well means looking at the last couple of turns, not re-deriving
  // precedent/web-search context from scratch.
  if (hasHistory && wordCount <= 15 && FOLLOW_UP_REFERENCE.test(normalized)) return "narrow";

  // Anything longer, or with no history to be "narrow" relative to, or
  // that reads as a genuinely new strategic question (decision-ish,
  // context-needing — see requiresContext/inferDecisionRouting) stays broad.
  // This is the safe default: only messages that clearly match one of the
  // narrow patterns above ever get the reduced-context treatment.
  return "broad";
}

// REMOVED: buildShortQueryFallback. It ran when the model failed to return
// parseable JSON for a short decision-shaped query, and returned a decision
// card holding one option named "Primary path" with the fixed scores
// viability 6 / speed 7 / defensibility 6 / capital_efficiency 6. Those
// numbers were not derived from anything — not the founder's message, not a
// precedent, not the model. The UI renders them exactly like real scored
// analysis, so the one moment a founder's request had actually failed was
// also the moment they were shown invented figures wearing Vera's judgment.
// The whole point of namedEntityGuard, the retrieval gate and the
// groundedness checks is that Vera does not make numbers up; this had us
// doing it in code, on the failure path, where nobody would think to look.
// A failed response now returns buildTransientErrorResponse — the one
// honest "that didn't work" message (see its comment in groq.ts).

// Code-side mirror of groq.ts's DRAFTING MODE trigger ("asking you to draft
// actual copy... as opposed to asking for strategic advice about content"),
// so the CONTEXT SUFFICIENCY GATE — a pre-model regex check the prompt has
// no way to override — never fires on a drafting request the prompt itself
// promises is exempt from it. Found live: "draft a short email to our
// landlord" was gated on "our" (personalBusinessReference) and never even
// reached the model, contradicting the prompt's own stated behavior.
const DRAFTING_REQUEST = /\b(draft|write|compose)\b.{0,40}\b(email|e-?mail|message|dm|post|caption|tweet|script|reel|talking points|letter|note|reply|response)\b/i;

function looksLikeDraftingRequest(message: string): boolean {
  return DRAFTING_REQUEST.test(message);
}

function requiresContext(message: string) {
  const normalized = normalizeQueryText(message);
  if (!normalized) return false;
  if (looksLikeDraftingRequest(message)) return false;

  const contextNeedWords = /(price|pricing|charge|cost|target customer|customer|segment|business model|model|industry|sector|stage|team size|audience|market|competitor|positioning|distribution|channel|go to market|g2m|launch|product|mvp|swot|growth|cac|ltv|unit economics|revenue|profit|margin|raise|funding|roadmap|hire|intern|talent|sales|retention|churn|pitch|deck|offer|subscription|risk|risks|threat|threats|weakness|weaknesses|vulnerability|vulnerabilities|priority|priorities|bottleneck|blocker|blockers|mistake|mistakes|blind spot|moat|differentiation|runway|burn)/i;

  // The fixed keyword list above can never fully anticipate every phrasing.
  // Any message that personally references "my/our/mine" (or asks someone to
  // fund/back/hire/acquire "us") is inherently about THIS specific company,
  // regardless of which noun follows — e.g. "what's MY biggest risk",
  // "companies similar to MINE", "most likely to fund US". Without this, a
  // query using none of the exact keywords above (like "risk") slips through
  // the gate entirely and Venus starts guessing instead of asking.
  const personalBusinessReference = /\b(my|our|mine|ours)\b/i.test(normalized)
    || /\b(fund|back|hire|acquire|invest in|work with)\s+us\b/i.test(normalized);

  // Don't gate genuinely generic definition questions ("what is a moat?"),
  // but a definition-style opener followed by "my/our/mine" is still a
  // personal question ("what's MY biggest risk") and must still be gated.
  const isSimpleDefinition = /(what is|what's|define|framework|concept|difference between|explain)/i.test(normalized)
    && !/\b(my|our|mine|ours)\b/i.test(normalized);

  return (contextNeedWords.test(normalized) || personalBusinessReference) && !isSimpleDefinition;
}

const BUSINESS_CONTEXT_SIGNAL = /\b(i run|i own|my business|my startup|my company|my gym|my app|my store|my shop|my product|we are|we're building|were building|we run|we sell|our (business|startup|company|product|gym|store|shop)|i'm building|im building|i have a|i've got a|ive got a|i'm the founder|im the founder|founder of)\b/i;

// BUSINESS_CONTEXT_SIGNAL only matches a fixed list of opener phrases
// ("I run", "we're building", etc.) and misses any message that describes
// the business in other natural phrasing — "We operate a subscription
// platform...", "We generate roughly $35,000 in MRR" contains neither "my
// business" nor "we're building" and was silently invisible to both
// isPureContextStatement and deriveContextFromHistory as a result. Real
// business descriptions are reliably identifiable by concrete metrics even
// when they don't use one of the fixed openers — catch those too.
//
// FIX: a bare `\d+%` used to be on this list and was by far the loosest
// entry on it — ANY sentence containing a percentage was classified as a
// business description. That is what made "not testing budget giving 25% as
// dscount is unreasonable" and "im saying wldnt giving 20% for discounts be
// too much loss" — both plainly corrections of Vera's previous answer — read
// as founders describing their company, so both were answered with "Got it —
// noted: ..." instead of an answer (confirmed live, twice in one session).
// A percentage on its own carries no information about what a business IS;
// it is just a number in a sentence about anything at all. Every other entry
// here names a real business quantity (currency amount, customer count,
// MRR/ARR/churn), and a genuine metric stated as a percentage still matches
// through those — "churn is 8%" on `churn`, "$35,000 MRR" on both the
// currency amount and `mrr`. So dropping it loses no real business
// description while removing the false-positive class at the root, rather
// than exempting phrasings one at a time downstream.
const BUSINESS_METRICS_SIGNAL = /(\$\s?[\d,]+|\d+\s+(paying\s+)?customers|monthly recurring revenue|\bmrr\b|\bchurn\b|\barr\b)/i;

function looksLikeBusinessContext(message: string): boolean {
  return BUSINESS_CONTEXT_SIGNAL.test(message) || BUSINESS_METRICS_SIGNAL.test(message);
}

// A message can BOTH describe the business AND ask a question in the same
// breath ("I run a clinic booking app — what should I prioritize?"). Only
// treat a message as a pure context-dump (no question attached) when it has
// no question mark and none of the decision/question verbs that
// inferDecisionRouting already treats as a question signal. This is what
// separates "just telling Venus about the business" from "telling Venus
// about the business as part of asking something."
//
// FIX: the original questionish list (should/would/could/help/how/what/
// why/which/when/recommend/advice/suggest/priorit) only covers
// interrogative phrasing. A real, substantive request phrased as an
// imperative — "Map the causal chain for my business from the most
// significant market shifts right now" — contains "my business" (matching
// BUSINESS_CONTEXT_SIGNAL), has no "?", and uses none of those words, so it
// was misclassified as a pure context statement and swallowed into a bare
// "Got it — noted" acknowledgment instead of ever reaching analysis. Added
// the imperative/analytical-verb family below to close that gap. This is a
// syntactic fix (imperative vs. declarative mood), not a judgment call, so
// it belongs here in the classifier rather than in the LLM prompt.
// FIX: "then whyd u say youtube takes 55% cut" and "...hows that possible"
// both went straight into buildContextAcknowledgment ("Got it — noted: ...
// What would you like help with?") instead of being answered — confirmed
// live. Both contain a bare percentage (matches BUSINESS_METRICS_SIGNAL
// above) and neither has a "?", so everything hinged on this regex; "whyd"
// and "hows" are informal contractions with the apostrophe simply omitted
// (not the "it's"->"it s" space-splitting normalizeQueryText produces
// elsewhere in this file), so \bwhy\b/\bhow\b never matched them. This also
// mattered beyond the immediate non-answer: a message swallowed here returns
// before classifyQuery ever runs, so a real correction phrased this way was
// invisible to the correction-capture pipeline (responseFeedback.ts) too.
// Same accommodation the "shld" entry below already makes for "should".
const questionish = /\b(should|shld|shouldnt|would|wouldnt|could|couldnt|worth|help|how|hows|howd|what|whats|whatd|why|whyd|which|when|whens|who|whos|whod|where|wheres|recommend|advice|suggest|priorit|map|analyz|identify|outline|breakdown|break down|walk me|walk through|compare|evaluat|assess|review|explain|tell me|give me|show me|list|summariz|forecast|plan|project|estimate|calculat)\b/i;

function isPureContextStatement(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!looksLikeBusinessContext(message)) return false;
  if (message.includes("?")) return false;
  return !questionish.test(normalized);
}

// Business context now lives on the founder's ACTIVE business_profiles row
// (see businessProfiles.ts) rather than one flat settings.venusBusinessContext
// blob per account — that flat-blob design was what made switching to a
// "new" business destructive: there was only ever one slot, so pivoting away
// from a business and back to it later meant re-describing it from scratch.
// getOrCreateActiveProfile auto-migrates a founder's legacy blob into their
// first profile the first time it runs for them, so this needs no separate
// data migration. These two helpers just read/write the already-resolved
// active profile passed in by the route, rather than re-querying it.
function getStoredBusinessContext(profile: BusinessProfile | null): string | undefined {
  return profile?.contextBlob || undefined;
}

async function saveStoredBusinessContext(profile: BusinessProfile | null, context: string): Promise<void> {
  if (!profile) return; // no active profile (DB hiccup) — best-effort, matches every other degrade-gracefully path in this file
  await updateProfileContext(profile.id, context);
}

// ---- Pending "same business or new?" confirmation state ----
//
// ROOT CAUSE THIS FIXES: buildBusinessContextConfirmation() used to return a
// one-shot question with nothing recording that it had been asked. The
// user's next message (e.g. a bare "new") was then re-run through
// isPureContextStatement/requiresContext from scratch — neither of which
// recognizes a short confirmation reply as meaningful — so it silently fell
// through every gate and reached the LLM with stale or empty
// effectiveBusinessContext. The model then answered anyway (the system
// prompt's sufficiency gate defaults to answering when unsure), producing a
// generic, ungrounded response that still carried a "verified precedent"
// confidence badge. Persisting the fact that a confirmation is pending closes
// that gap: the very next message is checked against it BEFORE any other
// classifier runs.

async function getPendingContextConfirmation(sessionId: string): Promise<boolean> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    return row?.pendingContextConfirmation ?? false;
  } catch {
    return false;
  }
}

async function setPendingContextConfirmation(sessionId: string, pending: boolean): Promise<void> {
  try {
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    if (existing) {
      await db.update(settingsTable)
        .set({ pendingContextConfirmation: pending, updatedAt: new Date() })
        .where(eq(settingsTable.sessionId, sessionId));
    } else if (pending) {
      // No row yet and nothing to clear — only worth inserting a fresh row
      // when we're actually setting the flag true.
      await db.insert(settingsTable)
        .values({ sessionId, pendingContextConfirmation: true })
        .onConflictDoNothing({ target: settingsTable.sessionId });
    }
  } catch {
    // Best-effort — if this fails, worst case the next reply gets re-gated
    // as a fresh message instead of being read as a confirmation answer,
    // which just re-asks rather than silently mis-answering.
  }
}

// ---- Pending "what does the new business do?" state ----
// Set the moment a founder confirms "new" to the same-or-new question above.
// The VERY NEXT message is checked against a founder's OTHER existing
// business profiles (see findMatchingProfile) before deciding whether to
// restore one or create a fresh one — without this flag, that message would
// just flow through as an ordinary context statement with no chance to
// detect "this is actually the coffee business you told me about last week."

async function getPendingNewProfileIntake(sessionId: string): Promise<boolean> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    return row?.pendingNewProfileIntake ?? false;
  } catch {
    return false;
  }
}

async function setPendingNewProfileIntake(sessionId: string, pending: boolean): Promise<void> {
  try {
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    if (existing) {
      await db.update(settingsTable)
        .set({ pendingNewProfileIntake: pending, updatedAt: new Date() })
        .where(eq(settingsTable.sessionId, sessionId));
    } else if (pending) {
      await db.insert(settingsTable)
        .values({ sessionId, pendingNewProfileIntake: true })
        .onConflictDoNothing({ target: settingsTable.sessionId });
    }
  } catch {
    // Best-effort — if this fails, the next message is just treated as an
    // ordinary context statement instead of checked against existing
    // profiles, which degrades to the old (pre-multi-profile) behavior
    // rather than breaking the response.
  }
}

// Classifies a short reply to the "same business or new?" question. Kept
// deliberately narrow and literal (not a general sentiment classifier) —
// this only ever runs when pendingContextConfirmation is true, so it is
// answering one specific yes/no-shaped question, not parsing arbitrary text.
function classifyContextConfirmationReply(message: string): "new" | "same" | "unclear" {
  const normalized = rejoinContractions(normalizeQueryText(message));

  // Negated-same phrasing means "new" — check first, since these phrases
  // contain the literal word "same"/"related" that the same-check below
  // would otherwise match on.
  if (/\bnot\s+(the\s+)?same\b|\bisnt\s+(the\s+)?same\b|\bnot\s+related\b/.test(normalized)) {
    return "new";
  }

  // FIX: this was originally anchored to the ENTIRE message (^...$), so it
  // only ever matched a bare "new"/"same" or one fixed trailing phrase.
  // Real replies to this question are rarely that terse — "same business,
  // just answer the question", "yes it's the same one", "forget any earlier
  // context, this is a brand new company" — all fell through as "unclear"
  // and silently re-asked the identical question forever (confirmed via
  // live testing; see the field-test report). Matching these phrases
  // anywhere in the reply is safe specifically because this classifier only
  // ever runs while this one yes/no-shaped question is pending — it is
  // still answering one narrow question, not parsing open-ended sentiment.
  if (/\bnew\b|\bdifferent\b|\bseparate business\b|\banother (business|company|one)\b|\bstarting (over|fresh)\b|\bforget (the |any )?(old|earlier|previous)\b/.test(normalized)) {
    return "new";
  }
  // Widened past the original three words for the same reason as the "new"
  // pattern above: "earlier"/"previous" are the obvious, natural way to
  // answer a question phrased as "the business you told me about earlier",
  // and a plain yes/yeah/correct is the obvious way to answer any yes/no
  // question — none of those matched before, so every one of them fell
  // through to "unclear" and re-triggered this exact question again.
  // Confirmed live: a founder replying "earlier" got asked this question a
  // third time in the same thread.
  if (/\bsame\b|\bcontinuing\b|\brelated\b|\bearlier\b|\bprevious\b|\byes\b|\byeah\b|\byep\b|\bcorrect\b/.test(normalized)) {
    return "same";
  }
  return "unclear";
}

// ---- Pending "should I remember this preference?" confirmation state ----
// (Item 3: correction detection + lightweight confirmation.) Same pattern as
// the business-context confirmation above: persisting the fact that a
// specific question was asked so the very next reply is checked against
// THAT question before any other classifier runs.

async function getPendingPreferenceText(sessionId: string): Promise<string | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    return row?.pendingPreferenceText ?? null;
  } catch {
    return null;
  }
}

async function setPendingPreferenceText(sessionId: string, text: string | null): Promise<void> {
  try {
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    if (existing) {
      await db.update(settingsTable).set({ pendingPreferenceText: text, updatedAt: new Date() }).where(eq(settingsTable.sessionId, sessionId));
    } else if (text) {
      await db.insert(settingsTable).values({ sessionId, pendingPreferenceText: text }).onConflictDoNothing({ target: settingsTable.sessionId });
    }
  } catch {
    // Best-effort — worst case the next reply gets re-gated as a fresh
    // message instead of read as an answer to this specific question.
  }
}

// Deliberately narrow and literal, same shape as classifyContextConfirmationReply
// above — this only ever runs when pendingPreferenceText is set, so it's
// answering one specific yes/no question, not parsing arbitrary sentiment.
function classifyYesNoReply(message: string): "yes" | "no" | "unclear" {
  const normalized = normalizeQueryText(message);
  if (/^\s*(yes|yep|yeah|sure|please do|go ahead|do it|correct|right)\s*[.!]?\s*$/i.test(normalized)) return "yes";
  if (/^\s*(no|nope|nah|don'?t|do not)\s*[.!]?\s*$/i.test(normalized)) return "no";
  return "unclear";
}

// ---- Pending fact-contradiction confirmation state ----
// (Item 4: risk-tiered fact storage.) A new business-context statement that
// looks like it contradicts an already-stored fact (see
// companyMemory.findPotentialContradiction) must never be silently
// overwritten or silently ignored — ask once, same philosophy as the
// business-pivot confirmation above.

interface PendingFactContradiction {
  oldFactId: number;
  newFactText: string;
  factType: string;
  sourceType: "onboarding" | "chat" | "checkin" | "decision" | "manual";
}

async function getPendingFactContradiction(sessionId: string): Promise<PendingFactContradiction | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    if (!row?.pendingFactContradiction) return null;
    return JSON.parse(row.pendingFactContradiction) as PendingFactContradiction;
  } catch {
    return null;
  }
}

async function setPendingFactContradiction(sessionId: string, value: PendingFactContradiction | null): Promise<void> {
  try {
    const encoded = value ? JSON.stringify(value) : null;
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, sessionId)).limit(1);
    if (existing) {
      await db.update(settingsTable).set({ pendingFactContradiction: encoded, updatedAt: new Date() }).where(eq(settingsTable.sessionId, sessionId));
    } else if (encoded) {
      await db.insert(settingsTable).values({ sessionId, pendingFactContradiction: encoded }).onConflictDoNothing({ target: settingsTable.sessionId });
    }
  } catch {
    // Best-effort — same degrade-gracefully philosophy as every other
    // pending-state setter in this file.
  }
}

function classifyContradictionResolutionReply(message: string): "update" | "both" | "unclear" {
  const normalized = rejoinContractions(normalizeQueryText(message));

  // FIX: the "update" side only recognized a handful of exact phrases
  // ("update", "change it", "replace") — a real reply like "that changed,
  // forget the old one, only the coffee business is real" matched none of
  // them and silently re-asked the identical question (confirmed via live
  // testing). Added the common natural ways to say "the old one is wrong
  // now" without loosening the "both true" side.
  if (/\b(update|updated|correct|corrected|change it|changed|replace|replaced|outdated)\b|\bno longer\b|\bnot anymore\b|\bforget (the |that )?(old|earlier|previous)\b/.test(normalized)) {
    return "update";
  }
  if (/\b(both|both true|still true|keep both|both real|both are true)\b|\bno both\b/.test(normalized)) {
    return "both";
  }
  return "unclear";
}

// Turns a decision/roadmap card into a short plain-text recommendation
// summary for fast future retrieval scoring (see retrieval.ts), without
// needing to re-parse the full card JSON on every subsequent query.
function summarizeCardForLogging(card: any): string | null {
  if (!card || typeof card !== "object") return null;
  const content = card.content;
  if (!content || typeof content !== "object") return null;

  if (card.type === "decision") {
    const topOption = Array.isArray(content.options) && content.options.length > 0 ? content.options[0]?.name : null;
    const recommendation = typeof content.recommendation === "string" ? content.recommendation : "";
    return [topOption ? `Considered: ${topOption}` : null, recommendation].filter(Boolean).join(" — ") || null;
  }
  if (card.type === "roadmap") {
    const firstPhase = Array.isArray(content.phases) && content.phases.length > 0 ? content.phases[0] : null;
    if (!firstPhase) return null;
    const actions = Array.isArray(firstPhase.actions) ? firstPhase.actions.slice(0, 2).join("; ") : "";
    return [firstPhase.title, actions].filter(Boolean).join(" — ") || null;
  }
  return null;
}

// ---- What the conversation log remembers of a card ----
//
// Only `summary` was ever written to the message log, so every option name,
// score, risk, phase and action Vera produced vanished the moment the
// response was rendered. The founder can see the card on screen; Vera
// cannot see it on the next turn. That is why "what was option B again?",
// "you said the risk was medium", or a correction aimed at a number that
// only ever existed inside a card land on a Vera that has no record of
// saying it — and a model with no record either agrees with whatever the
// founder asserts or contradicts itself. It reads as amnesia because it is.
//
// A compact digest, not the card JSON: enough for Vera to recognise and
// stand behind what it said, cheap enough to replay every turn. Full card
// content is already durable in venus_decisions (see autoLogDecisionCards).
function digestCardsForLog(cards: unknown): string {
  if (!Array.isArray(cards) || cards.length === 0) return "";

  const lines: string[] = [];
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    const c = card as any;
    const content = c.content ?? {};
    const label = typeof c.title === "string" && c.title ? c.title : c.type;

    if (c.type === "decision" && Array.isArray(content.options)) {
      const options = content.options
        .map((o: any) => (typeof o?.name === "string" ? o.name : null))
        .filter(Boolean)
        .join(" vs ");
      const call = typeof content.recommendation === "string" ? content.recommendation : "";
      lines.push(`decision "${label}": ${options}${call ? ` → ${call}` : ""}`);
    } else if (c.type === "risk" && Array.isArray(content.risks)) {
      const risks = content.risks
        .map((r: any) => (r?.name ? `${r.name} (${r.probability ?? "?"}%, ${r.impact ?? "?"} impact)` : null))
        .filter(Boolean)
        .join("; ");
      lines.push(`risks "${label}": ${risks}`);
    } else if (c.type === "roadmap" && Array.isArray(content.phases)) {
      const phases = content.phases
        .map((p: any) => (p?.period || p?.title ? `${p.period ?? ""} ${p.title ?? ""}`.trim() : null))
        .filter(Boolean)
        .join("; ");
      lines.push(`roadmap "${label}": ${phases}`);
    } else if (c.type === "analysis" && Array.isArray(content.points)) {
      const points = content.points
        .map((p: any) => (p?.label ? `${p.label}: ${p.value ?? ""}`.trim() : null))
        .filter(Boolean)
        .join("; ");
      lines.push(`analysis "${label}": ${points}`);
    } else if (c.type === "precedent" && Array.isArray(content.precedents)) {
      const names = content.precedents.map((p: any) => p?.company).filter(Boolean).join(", ");
      lines.push(`precedents "${label}": ${names}`);
    } else {
      lines.push(`${c.type} card "${label}"`);
    }
  }

  if (lines.length === 0) return "";
  const digest = lines.join("\n");
  const CARD_DIGEST_CHAR_LIMIT = 900;
  return digest.length > CARD_DIGEST_CHAR_LIMIT ? `${digest.slice(0, CARD_DIGEST_CHAR_LIMIT)}…` : digest;
}

// Writes a row for every decision/roadmap card Venus returns — this is what
// makes the memory start building itself from ordinary usage, with no extra
// action required from the founder. The founder (or a future conversational
// flow) fills in the outcome later via /ai/decisions/:id/outcome; until then
// the row just sits as "open" and isn't retrieved for future answers (only
// resolved decisions are, since an unresolved recommendation has no ground
// truth in it yet — see retrieveOwnResolvedDecisions).
const DUPLICATE_WINDOW_MS = 24 * 60 * 60_000;

async function autoLogDecisionCards(
  sessionId: string,
  query: string,
  businessContext: string | undefined,
  cards: any[],
  chatId?: number,
): Promise<void> {
  if (!Array.isArray(cards) || cards.length === 0) return;
  try {
    // Fetched once per call (not per card) — every card in this batch came
    // from the same founder message, so the dedup check against "open
    // decisions from this founder in the last 24h" only needs one query.
    let recentOpen: VenusDecision[] = [];
    try {
      recentOpen = await db
        .select()
        .from(venusDecisionsTable)
        .where(and(eq(venusDecisionsTable.sessionId, sessionId), eq(venusDecisionsTable.status, "open")));
    } catch {
      recentOpen = [];
    }
    const normalizedQuery = normalizeQueryText(query);
    const since = Date.now() - DUPLICATE_WINDOW_MS;

    for (const card of cards) {
      if (!card || (card.type !== "decision" && card.type !== "roadmap")) continue;
      const summary = summarizeCardForLogging(card);
      if (!summary) continue; // don't log a card we can't meaningfully summarize

      // Dedup guard: a near-identical open question re-asked by the same
      // founder within 24h (mid-session re-ask, retried message, etc.)
      // reinforces the existing row instead of bloating the log with a
      // near-duplicate that would otherwise compete for the same retrieval
      // slot as a genuinely distinct decision.
      const duplicate = recentOpen.find(
        (r) =>
          r.cardType === card.type &&
          normalizeQueryText(r.query) === normalizedQuery &&
          r.createdAt &&
          new Date(r.createdAt).getTime() >= since,
      );
      if (duplicate) {
        db.update(venusDecisionsTable)
          .set({ reinforcedCount: (duplicate.reinforcedCount ?? 1) + 1 })
          .where(eq(venusDecisionsTable.id, duplicate.id))
          .catch((err) => console.error("[autoLogDecisionCards] failed to bump reinforcedCount", err));
        continue;
      }

      const [inserted] = await db
        .insert(venusDecisionsTable)
        .values({
          sessionId,
          chatId: chatId ?? null,
          query,
          businessContextSnapshot: businessContext ?? null,
          cardType: card.type,
          recommendationSummary: summary,
          cardContentJson: JSON.stringify(card.content ?? {}),
          status: "open",
          decisionType: classifyDecisionType(query),
        })
        .returning();

      // Materialize trackable roadmap state (phases/actions that can be
      // checked off over time) alongside the decision-log row — additive
      // only, never blocks or affects the decision row itself. Requires a
      // chatId since roadmaps are scoped to a chat/project the same way
      // goals are (see roadmaps.ts).
      if (card.type === "roadmap" && chatId && inserted) {
        materializeRoadmapFromCard({
          userId: sessionId,
          chatId,
          sourceDecisionId: inserted.id,
          title: summary,
          cardContent: card.content,
        })
          .then((roadmap) => {
            if (!roadmap) return;
            return db
              .update(venusDecisionsTable)
              .set({ roadmapId: roadmap.id })
              .where(eq(venusDecisionsTable.id, inserted.id));
          })
          .catch((err) => console.error("[autoLogDecisionCards] failed to link roadmapId", err));
      }
    }
  } catch (err) {
    // Never let logging failure break the actual chat response — this is
    // purely additive memory-building, not something the user is waiting on.
    console.error("[autoLogDecisionCards] failed to log decision card(s)", err);
  }
}

// Rough signal that a new context-bearing message might describe a DIFFERENT
// business than what's already stored, rather than adding detail to the same
// one. Deliberately conservative (word-overlap based, not semantic) — the
// goal is only to catch clearly unrelated pivots ("my gym" vs "my SaaS
// startup for clinics") and ask once, not to second-guess every rephrasing
// of the same business.
function looksLikeDifferentBusiness(storedContext: string, newMessage: string): boolean {
  const stopwords = new Set(["the", "and", "for", "with", "that", "this", "have", "has", "are", "was", "were", "been", "being", "into", "from", "about", "just", "also", "very", "really", "will", "would", "could", "should", "their", "them", "they", "your", "you", "our", "ours", "business", "startup", "company"]);
  const words = (s: string) => new Set(
    normalizeQueryText(s).split(" ").filter((w) => w.length > 3 && !stopwords.has(w)),
  );
  const storedWords = words(storedContext);
  const newWords = words(newMessage);
  if (storedWords.size === 0 || newWords.size === 0) return false;
  let overlap = 0;
  newWords.forEach((w) => { if (storedWords.has(w)) overlap++; });
  // If a meaningfully-sized new context statement shares almost no
  // vocabulary with what's stored, treat it as a likely pivot to confirm.
  return newWords.size >= 4 && overlap === 0;
}

function deriveContextFromHistory(sessionHistory?: { role?: string; content?: string }[]): string | undefined {
  if (!sessionHistory || sessionHistory.length === 0) return undefined;

  const contextMessages = sessionHistory
    .filter((h) => h.role === "user" && typeof h.content === "string" && looksLikeBusinessContext(h.content))
    .map((h) => h.content as string);

  if (contextMessages.length === 0) return undefined;
  return contextMessages.join(" | ");
}

function buildContextClarification(
  message: string,
  businessContext?: string,
  sessionHistory?: { role?: string; content?: string }[],
) {
  if (!requiresContext(message)) return null;

  // If the user already gave business context earlier in this session (or it was
  // passed explicitly), do NOT re-gate — just proceed to answer using it.
  //
  // FIX: this used to only check businessContext/history, never the message
  // that's actually triggering this gate. A first-time context dump like "We
  // operate a subscription platform for gyms... 450 paying customers...
  // $35,000 MRR" trips requiresContext() (it's full of business keywords)
  // but has nothing stored yet — so it was gated and asked "what industry,
  // what stage?" even though both answers are sitting in the same message.
  // A message that already looks like a real business description is a
  // valid context source in its own right.
  const existingContext = businessContext || deriveContextFromHistory(sessionHistory) || (looksLikeBusinessContext(message) ? message : undefined);
  if (existingContext) return null;

  const contextHints = [
    "What industry or sector are you in?",
    "What stage is the business at and who is the customer?",
  ];

  const prefix = "To answer this well, I need two quick details:";
  return {
    summary: `${prefix} ${contextHints.join(" ")}`,
    cards: [
      {
        type: "analysis",
        title: "Need a bit more context",
        content: {
          points: [
            { label: "Why", value: "The answer depends on your business context, not just the general question.", sentiment: "neutral" },
            { label: "Needed", value: "Industry/sector and target customer or stage.", sentiment: "neutral" },
          ],
        },
      },
    ],
    // Deliberately no confidence/confidenceNote here — this is a clarifying
    // question, not an analysis, so a confidence badge on it is meaningless
    // and reads as if Venus is unsure of itself rather than just asking a
    // normal follow-up question. The badge is reserved for actual answers.
    requiresClarification: true,
  };
}

// State: user just described their business with no actual question attached
// ("I'm the founder of a HealthTech startup helping clinics..."). Per the
// desired flow, Venus should NOT try to analyze or advise here — there is no
// question to answer yet. It should just acknowledge that the context has
// been noted and ask what they'd like help with, then let the human ask the
// real question next.
//
// FIX: this used to be a hardcoded string returned unconditionally whenever
// isPureContextStatement() was true — including on messages that only
// glancingly matched BUSINESS_CONTEXT_SIGNAL (e.g. "but u dint even ask for
// my business", which contains "my business" but describes no actual
// business). It would confidently say "noted your business context" with
// nothing real behind the claim. Now it requires the actual captured text
// and echoes a short piece of it back, so the acknowledgment can never claim
// to have context it doesn't have.
function buildContextAcknowledgment(capturedContext: string): object {
  const trimmed = capturedContext.trim();
  // Guard against the exact failure from the screenshots: BUSINESS_CONTEXT_SIGNAL
  // can match phrases that reference "business" without describing one. If
  // there isn't enough real content here to reflect back, don't claim there is.
  const meaningfulWords = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (meaningfulWords.length < 3) {
    return {
      summary: "I want to make sure I get this right — what does the business actually do, what stage is it at, and who's the customer?",
      cards: [],
      requiresClarification: true,
    };
  }
  const preview = trimmed.length > 140 ? `${trimmed.slice(0, 140).trim()}…` : trimmed;
  return {
    summary: `Got it — noted: "${preview}". What would you like help with?`,
    cards: [],
    // No confidence badge — this is a plain acknowledgment, not an answer,
    // so "exploratory"/"verified" doesn't mean anything here and previously
    // just showed a confusing orange "Exploratory" badge on a message that
    // isn't making any claim that could be more or less confident.
    contextAcknowledged: true,
  };
}

// State: business context is already stored from a previous message/session,
// but the new message reads like it might describe a DIFFERENT business
// entirely. Ask once rather than silently overwriting or silently ignoring
// the new context.
//
// IMPORTANT: the caller MUST call setPendingContextConfirmation(sessionId,
// true) alongside returning this — otherwise the question has no memory of
// having been asked, and the user's next reply (e.g. a bare "new") falls
// through every other classifier unrecognized and reaches the LLM with
// stale/empty context. This was the exact mechanism behind the hallucinated
// "AI and digital payments" answer and the false "Got it — noted your
// business context" that followed it.
function buildBusinessContextConfirmation(): object {
  return {
    summary: "Quick check before I continue — is this related to the business you told me about earlier, or is this a new/different business idea?",
    cards: [],
    // No confidence badge — same reasoning as buildContextAcknowledgment
    // above, this is a clarifying question, not an analysis.
    requiresContextConfirmation: true,
  };
}

// State: the founder replied "new" (or similar) to the confirmation above.
// There is no business context yet for this new idea — do NOT fall through
// to analysis with stale or empty context. Ask the same intake question a
// first-time founder would get, and clear the stale stored context so it
// can't leak into the new business's answers.
function buildFreshContextIntake(): object {
  return {
    summary: "Got it, starting fresh. What does the new business do — industry, stage, and who's the customer?",
    cards: [],
    requiresClarification: true,
  };
}

function applyTierLabel(parsed: { summary?: unknown }, retrieval: RetrievalResult) {
  // Deliberately does nothing to the summary field anymore. This used to
  // prepend "Exploratory signal — limited precedent coverage." as a forced
  // first line on every moderate-tier answer — on top of the prompt (see
  // MODERATE_TIER_PRECEDENT_NOTE) already asking the model to open with the
  // same phrase, so it doubled up and made every thinner-precedent answer
  // read as a product disclaimer rather than a real recommendation. The
  // lower-confidence signal is now carried only in confidenceNote (a small,
  // secondary badge in the UI, not the lede of the actual answer) — see
  // confidenceNote assignment below, which already softens the wording to a
  // brief caveat rather than a warning.
  return parsed;
}

// NOTE: this function is currently unused by the /ai/analyze flow (that route
// lets the "none" tier fall through to normal LLM reasoning with the
// noPrecedentInstruction system-prompt note, which is the correct behavior).
// Kept here in case another route wants a standalone "coverage gap" card, but
// the copy below intentionally does NOT ask the user to reword their query —
// a missing precedent is a dataset-coverage gap, not a prompting mistake.
function buildInsufficientPrecedentResponse(query: string, retrieval: RetrievalResult): object {
  const sectorNote = retrieval.inferredSector
    ? `the verified precedent dataset only has ${retrieval.sectorCoverageCount} record(s) in the "${retrieval.inferredSector}" sector`
    : `this query didn't match any sector in the verified precedent dataset`;
  return {
    summary: `⚠️ No verified precedent match — the answer below is general strategic reasoning, not backed by Venus AI's dataset. Treat it as a useful starting point, not a data-grounded verdict.`,
    cards: [
      {
        type: "risk",
        title: "Precedent Coverage Gap",
        content: {
          risks: [
            {
              name: "Insufficient grounded data",
              probability: 100,
              impact: "High",
              mitigation: `This is a gap in dataset coverage, not a problem with how the question was asked — ${sectorNote}. The reasoning above still applies; just weigh it as an informed opinion rather than a precedent-backed call.`,
            },
          ],
        },
      },
    ],
    retrievalGated: true,
    matchConfidence: retrieval.confidence,
    inferredSector: retrieval.inferredSector,
  };
}

// ---- Server-side input bounds ----
//
// VenusAnalyzeBody (generated from the API spec) validates `message` only as
// `string().min(1)` and `sessionHistory` as an unbounded array of unbounded
// strings — and the frontend replays its ENTIRE conversation on every single
// request (see Venus.tsx's analyze call). So request size grows without
// limit as a chat gets longer, on a budget the static system prompt already
// exhausts by itself. That shows up as the 413 shrink-and-retry storms this
// file's comments document, and every shrink cuts real grounding material.
//
// Bounded here rather than in the generated schema so the contract stays
// generated and this stays a server-side safety property: a request over the
// bound is trimmed and answered, never rejected. The founder's CURRENT
// message is what matters most, so it keeps the largest allowance; history
// is capped by turn count first (oldest dropped) and then per-turn length.
const MAX_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_TURNS = 24;
const MAX_HISTORY_TURN_CHARS = 4_000;

function boundAnalyzeInput(data: { message: string; sessionHistory?: { role: string; content: string }[] }) {
  const message =
    data.message.length > MAX_MESSAGE_CHARS
      ? `${data.message.slice(0, MAX_MESSAGE_CHARS)}\n\n[Message truncated at ${MAX_MESSAGE_CHARS} characters.]`
      : data.message;

  const sessionHistory = (data.sessionHistory ?? []).slice(-MAX_HISTORY_TURNS).map((h) => ({
    // The generated schema types `role` as a free-form string, so a client
    // can send anything here. Everything downstream already follows the
    // tolerant "not 'user' means it's Vera's turn" convention (the frontend
    // labels its own turns "venus"), so normalise to that once, at the
    // boundary, instead of re-deriving it at five call sites.
    role: h.role === "user" ? "user" : "assistant",
    content:
      typeof h.content === "string" && h.content.length > MAX_HISTORY_TURN_CHARS
        ? `${h.content.slice(0, MAX_HISTORY_TURN_CHARS)}…`
        : (h.content ?? ""),
  }));

  return { message, sessionHistory };
}

router.post("/ai/analyze", requireAuth, async (req, res) => {
  const parsedBody = VenusAnalyzeBody.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Invalid request body" });

  const bounded = boundAnalyzeInput(parsedBody.data);
  // Shadowing the parse result with a bounded copy means every `body.data.*`
  // read below this line — there are dozens — sees the trimmed values
  // automatically, with no chance of one call site missing the bound.
  const body = { data: { ...parsedBody.data, ...bounded } };

  try {
    // Previously `(req.headers["x-session-id"] as string) || req.ip || "default"`
    // — req.ip is unstable across NAT/mobile-network/VPN hops and shared by
    // anyone on the same network, so decision history, roadmap cards, and
    // (once built) Goal state could leak between unrelated people. Now backed
    // by a Clerk-verified user id via requireAuth above.
    const sessionId = requireUserId(req);
    // REMOVED: an `x-groq-api-key` request header that, when present, was used
    // to construct the Groq client instead of the server's own credential.
    // Any caller could set it, so it was an unauthenticated way to steer this
    // route's outbound LLM calls at an arbitrary third-party key — and, with
    // CORS previously set to `*`, settable from any origin. Inference now
    // always runs on the server's own key; see getGroqClient in lib/groq.ts.
    const groq = getGroqClient();

    // ---- Every turn gets logged, including the ones that never reach the model ----
    //
    // logMessage for the founder's turn sits far below this point, AFTER
    // every gate has had its chance to return. So the durable message log
    // had holes exactly where the conversation did its most important work:
    // a founder's first business-context dump, their answer to "same
    // business or new?", a stored preference, a resolved contradiction —
    // none of it recorded, on either side. And because serverHistory
    // (sourced from that same log) overrides the client's copy whenever a
    // chatId exists, those turns were invisible on later requests too. Vera
    // would ask a question, be told the answer, and have no record that
    // either happened.
    //
    // Every gated response now goes through here instead of a bare
    // res.json, so "did we log this turn?" stops being a question anyone has
    // to remember to ask at each of the dozen early returns below.
    // `object` rather than a precise shape because the gate builders
    // (buildContextAcknowledgment, buildBusinessContextConfirmation, …) are
    // typed as returning plain `object`; the summary is read defensively.
    // Sequenced rather than fired in parallel so the chat-summary refresh at
    // the end sees BOTH sides of this turn in the log. Still fire-and-forget
    // from the response's point of view — res.json does not wait on it.
    const respondGated = (payload: object) => {
      const summary = (payload as { summary?: unknown }).summary;
      logMessage({ userId: sessionId, chatId: body.data.chatId, role: "user", content: body.data.message })
        .then(() =>
          typeof summary === "string"
            ? logMessage({ userId: sessionId, chatId: body.data.chatId, role: "assistant", content: summary })
            : undefined,
        )
        // The gated turns are where a founder states their business, answers
        // "same company or new?", or sets a preference — the turns most worth
        // remembering, and the ones a summariser wired only to the model path
        // would never see.
        .then(() => ensureChatSummary(sessionId, body.data.chatId))
        .catch(() => {});
      return res.json(payload);
    };

    // ---- Crisis check. FIRST, ahead of every other gate, and ahead of the
    // Groq client check below ----
    //
    // Position is the whole design here. Every gate under this one is about
    // the BUSINESS — which profile is active, is this the same company, is
    // there enough context to answer. Someone who has just said they want to
    // hurt themselves must not be asked "is this the same business or a new
    // one?", must not be told Vera needs more context about their company,
    // and must not be told the API key is missing. Any of those is the
    // product continuing its script over the top of a person, and each one is
    // reachable if this check sits even one gate lower.
    //
    // It also runs before the model is called at all, which is what fixes the
    // observed failure rather than papering over it: there is no completion to
    // refuse, and nothing for the confidence layer to badge as "EXPLORATORY —
    // grounded in a live web search". See lib/crisisSupport.ts.
    //
    // Routed through respondGated so the turn is still logged on both sides —
    // this is the last thing that should silently vanish from a person's
    // history, whether they come back to it or someone else ever has to.
    if (needsCrisisResponse(body.data.message)) {
      req.log.warn({ userId: sessionId }, "Crisis response served — model bypassed");
      return respondGated(buildCrisisResponse());
    }

    if (!groq) {
      // Not routed through respondGated: with no Groq client this turn never
      // became part of a conversation at all, and logging a configuration
      // error as if it were Vera's reply would poison the history that later
      // turns reason from.
      return res.json(buildFallbackVenusResponse(body.data.message));
    }

    // Resolved once per request and threaded through everything below —
    // which of a founder's (possibly several) businesses this conversation
    // is currently about. Auto-provisions a first profile from legacy
    // single-blob state the first time this runs for a given founder (see
    // businessProfiles.ts), so nobody is reset to nothing by this existing.
    const activeProfile = await getOrCreateActiveProfile(sessionId);

    // Business context now persists in three layers, checked in order of
    // freshness: (1) context explicitly passed on this request, (2) context
    // mentioned earlier in the CURRENT chat session, (3) context saved to the
    // database from ANY previous session — this is what makes Venus remember
    // the business across brand new chats instead of only within one session.
    // Layer 3 is scoped to whichever business profile is currently active,
    // not the whole account, so switching profiles actually changes what's
    // remembered instead of blending every business together.
    const sessionHistoryContext = deriveContextFromHistory(body.data.sessionHistory);
    const storedContext = getStoredBusinessContext(activeProfile);

    // MUST run before every other classifier below. If the previous turn was
    // "is this the same business or a new one?", this message is the answer
    // to THAT question, not a fresh query — treating it as fresh is exactly
    // what let a bare "new" fall through isPureContextStatement (false, no
    // BUSINESS_CONTEXT_SIGNAL match) and requiresContext (false, no keyword
    // match) untouched, reach the LLM with stale/empty context, and come
    // back as a generic, ungrounded answer with a confidence badge on it.
    const awaitingConfirmation = await getPendingContextConfirmation(sessionId);
    if (awaitingConfirmation) {
      const reply = classifyContextConfirmationReply(body.data.message);
      if (reply === "new") {
        await setPendingContextConfirmation(sessionId, false);
        // FIX: this used to destructively clear the context blob AND every
        // structured company_facts row right here, on the spot — correct for
        // a genuine one-time pivot, but it meant a founder juggling 2-3 real
        // businesses lost everything Vera knew the moment they switched away
        // from one, even temporarily. We don't yet know what the "new"
        // business actually is, so the decision (restore an existing profile
        // vs. create a genuinely new one) now waits for the founder's answer
        // to buildFreshContextIntake() below — see awaitingNewProfileIntake.
        await setPendingNewProfileIntake(sessionId, true);
        return respondGated(buildFreshContextIntake());
      }
      if (reply === "same") {
        await setPendingContextConfirmation(sessionId, false);
        // Fall through to normal handling below, now using the existing
        // storedContext as intended (the "different business" branch further
        // down won't re-fire because pending is now false).
      } else {
        // Reply didn't clearly answer new-vs-same — re-ask rather than
        // guessing, so we never silently pick a side.
        return respondGated(buildBusinessContextConfirmation());
      }
    }

    // ---- Resolving "what does the new business do?" against existing profiles ----
    // Set one turn ago, the moment the founder confirmed "new" above. This
    // message is the answer to buildFreshContextIntake()'s question — check
    // it against the founder's OTHER existing profiles before deciding
    // whether to restore one (no data lost, no re-describing) or create a
    // genuinely new one. Skipped (not awaited at all) when awaitingConfirmation
    // fired this turn, since that path only just NOW asked the question this
    // block would otherwise try to answer.
    const awaitingNewProfileIntake = !awaitingConfirmation && (await getPendingNewProfileIntake(sessionId));
    if (awaitingNewProfileIntake) {
      await setPendingNewProfileIntake(sessionId, false);
      // Guard against a founder ignoring the intake question and asking
      // something else instead ("actually nvm, what's my biggest risk") —
      // only treat this as a business description if it actually reads like
      // one; otherwise fall through to ordinary handling with whatever
      // profile is still active rather than creating a nonsense profile
      // named after an unrelated question.
      if (isPureContextStatement(body.data.message)) {
        const matched = await findMatchingProfile(sessionId, body.data.message, activeProfile?.id ?? undefined);
        if (matched) {
          await setActiveProfile(sessionId, matched.id);
          return respondGated({
            summary: `This sounds like **${matched.name}** — the business you told me about before. Switching back to it instead of starting fresh. What would you like help with?`,
            cards: [],
            contextAcknowledged: true,
          });
        }
        const newProfile = await createProfile(sessionId, body.data.message);
        if (newProfile) {
          await setActiveProfile(sessionId, newProfile.id);
          addCompanyFact({ userId: sessionId, factText: body.data.message, sourceType: "chat", profileId: newProfile.id }).catch(() => {});
        }
        return respondGated(buildContextAcknowledgment(body.data.message));
      }
      // Not a business description — leave the active profile as-is and let
      // the message fall through to normal handling below.
    }

    // ---- Item 4: pending fact-contradiction confirmation ----
    // Same priority tier as the business-pivot confirmation above — if the
    // previous turn asked "you told me X before, now Y — update or both
    // true?", this message is the answer to THAT question.
    const pendingContradiction = await getPendingFactContradiction(sessionId);
    if (pendingContradiction) {
      const resolution = classifyContradictionResolutionReply(body.data.message);
      if (resolution === "update") {
        await setPendingFactContradiction(sessionId, null);
        await supersedeFact(pendingContradiction.oldFactId, {
          userId: sessionId,
          factText: pendingContradiction.newFactText,
          factType: pendingContradiction.factType,
          sourceType: pendingContradiction.sourceType,
          profileId: activeProfile?.id ?? null,
        });
        return respondGated({ summary: "Got it — updated.", cards: [], contextAcknowledged: true });
      }
      if (resolution === "both") {
        await setPendingFactContradiction(sessionId, null);
        await addCompanyFact({
          userId: sessionId,
          factText: pendingContradiction.newFactText,
          factType: pendingContradiction.factType,
          sourceType: pendingContradiction.sourceType,
          profileId: activeProfile?.id ?? null,
        });
        return respondGated({ summary: "Got it — I'll keep both as true.", cards: [], contextAcknowledged: true });
      }
      // Unclear — re-ask rather than guessing which one to keep.
      return respondGated({
        summary: "Just to be sure — did that replace what you told me before, or are both still true?",
        cards: [],
        requiresClarification: true,
      });
    }

    // ---- Item 3: pending "should I remember this preference?" confirmation ----
    const pendingPreference = await getPendingPreferenceText(sessionId);
    if (pendingPreference) {
      const reply = classifyYesNoReply(body.data.message);
      if (reply === "yes") {
        await setPendingPreferenceText(sessionId, null);
        await addCompanyFact({ userId: sessionId, factText: pendingPreference, entryKind: "preference", claimType: "style_preference", sourceType: "chat" });
        return respondGated({ summary: "Got it — I'll remember that.", cards: [], contextAcknowledged: true });
      }
      if (reply === "no") {
        await setPendingPreferenceText(sessionId, null);
        // Exactly one follow-up question, then move on — never re-ask this
        // same thing again on the next message.
        return respondGated({ summary: "Got it — what should I do instead?", cards: [], requiresClarification: true });
      }
      return respondGated({
        summary: `Got it — should I remember "${pendingPreference}" going forward?`,
        cards: [],
        requiresPreferenceConfirmation: true,
      });
    }

    // ---- Item 3: correction detection ----
    // Cheap regex pre-filter (looksLikeCorrection + looksLikeGeneralizablePreference)
    // decides whether it's even worth spending a model call; only when BOTH
    // fire does this ask the model itself to judge whether the message is a
    // genuine standing preference (vs. a one-off correction specific to this
    // instance) — see preferenceDetection.ts for why this is a 3-layer check
    // rather than a hardcoded keyword rule. Skipped entirely (zero extra
    // cost) on the far more common case where the regex pre-filter doesn't fire.
    // Not `=== "assistant"` — the frontend's ChatMessage role for Vera's own
    // turns is "venus" (see vera-nexus/src/pages/Venus.tsx), not "assistant".
    // Matches the same tolerant convention already used elsewhere in this
    // file (messageHistoryTurnCount's push loop, historyContext's label):
    // anything that isn't "user" is treated as the assistant/Vera turn.
    let priorAssistantMessage = [...(body.data.sessionHistory ?? [])].reverse().find((h) => h.role && h.role !== "user")?.content ?? "";
    let priorUserMessage = [...(body.data.sessionHistory ?? [])].reverse().find((h) => h.role === "user")?.content ?? "";

    // sessionHistory is CLIENT-sent (the frontend replays its localStorage
    // copy on every request), so it is absent or empty in every case where
    // the client's local copy isn't there: a page refresh, a different
    // device, cleared storage, or any non-browser caller. Everything that
    // depends on knowing what Vera last said then goes dark at once —
    // correction detection, the answer-withholding guard below, and the
    // regression log — and the founder gets the "Got it — noted" non-answer
    // again purely because they reloaded the tab.
    //
    // The server has the turn: it's in the durable message log. Read it back
    // when the client didn't supply one. One small indexed query, and only
    // on the path where the client left us blind, so the normal request pays
    // nothing for it.
    if (!priorAssistantMessage && body.data.chatId) {
      const logged = await getRecentMessages(sessionId, body.data.chatId, 6);
      priorAssistantMessage = [...logged].reverse().find((m) => m.role !== "user")?.content ?? "";
      if (!priorUserMessage) {
        priorUserMessage = [...logged].reverse().find((m) => m.role === "user")?.content ?? "";
      }
    }

    // FIRED HERE, AWAITED LATER. This is the same single classification call
    // that has always run for every message — it is only started earlier now,
    // because two of its outputs (correctsPriorAnswer / detectedIssue) are
    // needed by the answer-withholding gates below, and those gates used to
    // return a response before this call was ever made. That ordering was the
    // structural bug: the one component that understands what a message MEANS
    // ran strictly after the components that decide whether to answer it at
    // all, so its verdict could never influence that decision.
    //
    // Starting it as a floating promise keeps the fix free on the common path
    // — a normal question never awaits it here, and it is still resolved
    // alongside retrievePrecedents further down, exactly as before. Only a
    // message that one of the gates is about to swallow pays the wait, and
    // that path currently pays nothing and returns the wrong thing.
    const classificationPromise = classifyQuery(groq, body.data.message, priorAssistantMessage);
    // classifyQuery never rejects (it catches internally and returns
    // DEFAULT_CLASSIFICATION), but an early return below can leave this
    // promise unawaited — attach a no-op so a future change to that contract
    // can't surface as an unhandled rejection instead of a degraded answer.
    classificationPromise.catch(() => {});

    if (priorAssistantMessage && looksLikeCorrection(body.data.message, priorAssistantMessage) && looksLikeGeneralizablePreference(body.data.message)) {
      const existingPreferences = await getActivePreferenceFacts(sessionId, 20);
      if (!looksLikeExistingPreference(existingPreferences.map((f) => f.factText), body.data.message)) {
        const modelCheck = await confirmPreferenceWithModel(groq, body.data.message, priorAssistantMessage);
        if (modelCheck?.isStandingPreference && modelCheck.preferenceText) {
          await setPendingPreferenceText(sessionId, modelCheck.preferenceText);
          return respondGated({
            summary: `Got it — should I remember "${modelCheck.preferenceText}" going forward?`,
            cards: [],
            requiresPreferenceConfirmation: true,
          });
        }
      }
    }

    // `let`, not `const`: a correction that also carries business context
    // updates this in place further down, so the answer produced THIS turn
    // already reasons from the corrected version rather than the stale one.
    let effectiveBusinessContext = body.data.businessContext || sessionHistoryContext || storedContext;

    // ---- ANSWER-WITHHOLDING GATE GUARD ----
    //
    // Both gates below (the pure-context acknowledgment and the "I need two
    // quick details" clarification) respond WITHOUT answering. That is the
    // right behavior for a founder opening a chat by describing their
    // company, and the wrong behavior for essentially everything else — most
    // damagingly for a founder correcting an answer Vera just gave, which is
    // exactly when they are least willing to tolerate a non-answer.
    //
    // Both gates judged the message by its CONTENT alone (business vocabulary
    // present, question word absent) and were blind to what the message was
    // DOING in the conversation. See lib/turnIntent.ts for why that axis, not
    // a longer keyword list, is the actual root of this failure class. A
    // message that is a reply to Vera's own last turn is never a context dump
    // and never needs an intake question — the conversation is already
    // underway, and the founder is owed an answer.
    //
    // The model check is only awaited when a gate is actually about to fire,
    // so the ordinary path costs nothing (see classificationPromise above).
    const pureContextStatementByShape = isPureContextStatement(body.data.message);
    const clarificationCandidate = buildContextClarification(body.data.message, effectiveBusinessContext, body.data.sessionHistory);
    const someGateWouldWithholdAnswer = pureContextStatementByShape || Boolean(clarificationCandidate);

    let replySource: ReplyDetectionSource = "none";
    if (priorAssistantMessage && someGateWouldWithholdAnswer) {
      if (looksLikeReplyToPriorTurn(body.data.message, priorAssistantMessage)) {
        replySource = "structural";
      } else {
        const intent = await classificationPromise;
        if (intent.correctsPriorAnswer) {
          replySource = "model";
        } else if (intent.failed) {
          // Classification didn't actually run (network, quota, bad JSON) —
          // so `correctsPriorAnswer: false` here is a placeholder, not a
          // judgment. Treating a placeholder as "definitely not a reply"
          // would re-arm the exact non-answer this guard exists to prevent,
          // and would do it precisely when the system is already degraded.
          // Resolve the unknown toward answering. See ReplyDetectionSource.
          replySource = "fail_open";
        }
      }
    }
    const isReplyToPriorTurn = replySource !== "none";
    if (isReplyToPriorTurn) {
      console.error(
        `[turnIntent] session=${sessionId} routed=answer source=${replySource} gate=${pureContextStatementByShape ? "pureContext" : "clarification"} message="${body.data.message.slice(0, 120)}"`,
      );
    }

    const pureContextStatement = pureContextStatementByShape && !isReplyToPriorTurn;

    // A reply that ALSO carries real business context ("no, we're B2B, not a
    // marketplace") must still update what Vera knows — it just must not stop
    // there. Captured silently and fire-and-forget, then execution falls
    // through to the normal answer path below. Deliberately skips the
    // blocking contradiction question that the standalone branch asks: a
    // correction IS the founder resolving the contradiction, so asking them
    // to confirm it is another non-answer at the worst possible moment.
    if (pureContextStatementByShape && isReplyToPriorTurn) {
      const combinedContext = storedContext && !looksLikeDifferentBusiness(storedContext, body.data.message)
        ? mergeContextBlob(storedContext, body.data.message)
        : body.data.message;
      await saveStoredBusinessContext(activeProfile, combinedContext);
      addCompanyFact({ userId: sessionId, factText: body.data.message, sourceType: "chat", profileId: activeProfile?.id ?? null }).catch(() => {});
      // Answer THIS turn from the corrected context, not the version the
      // founder just told us was wrong — persisting it for next time isn't
      // enough when the correction is the whole point of the message.
      effectiveBusinessContext = combinedContext;
    }

    // If this message looks like a different business than what's already
    // stored, don't silently overwrite it or silently keep using the old one
    // — ask once. Only fires when something is actually stored yet, so a
    // first-time context statement never triggers this. Skipped when we just
    // resolved a pending confirmation above (awaitingConfirmation was true),
    // since that question has already been asked and answered this turn.
    if (!awaitingConfirmation && storedContext && pureContextStatement && looksLikeDifferentBusiness(storedContext, body.data.message)) {
      await setPendingContextConfirmation(sessionId, true);
      return respondGated(buildBusinessContextConfirmation());
    }

    // Pure context statement (no question attached): save it and acknowledge
    // only. Don't run analysis yet — there's nothing to analyze, the human
    // hasn't asked anything.
    if (pureContextStatement) {
      const combinedContext = storedContext && !looksLikeDifferentBusiness(storedContext, body.data.message)
        ? mergeContextBlob(storedContext, body.data.message)
        : body.data.message;
      await saveStoredBusinessContext(activeProfile, combinedContext);

      // Before logging this as a new structured fact, check whether it
      // contradicts an already-stored one (see companyMemory.findPotentialContradiction)
      // — a genuine conflict must be surfaced and confirmed, never silently
      // overwritten or silently duplicated. This IS blocking (one cheap DB
      // read), unlike the fire-and-forget log below, because the founder
      // needs an answer this turn if there's a real conflict to resolve.
      // Scoped to the active profile so a detail about THIS business is
      // never flagged as "contradicting" an unrelated one.
      const conflict = await findPotentialContradiction(sessionId, "general", body.data.message, activeProfile?.id);
      if (conflict) {
        await setPendingFactContradiction(sessionId, { oldFactId: conflict.id, newFactText: body.data.message, factType: "general", sourceType: "chat" });
        return respondGated({
          summary: `You told me before: "${conflict.factText}" — this sounds different: "${body.data.message}". Did that change, or are both true?`,
          cards: [],
          requiresClarification: true,
        });
      }

      // Also log the atomic new statement (not the whole growing blob) as
      // its own structured fact — see companyMemory.ts for why this exists
      // alongside the blob rather than replacing it. Fire-and-forget:
      // addCompanyFact never throws, but this must never delay the response.
      addCompanyFact({ userId: sessionId, factText: body.data.message, sourceType: "chat", profileId: activeProfile?.id ?? null }).catch(() => {});
      return respondGated(buildContextAcknowledgment(combinedContext));
    }

    // Computed above (clarificationCandidate) rather than here, so the reply
    // guard could take it into account before deciding whether to spend a
    // model check. Asking a founder who is mid-correction "what industry are
    // you in?" is the same non-answer failure as the acknowledgment above,
    // one gate later — they are replying to an answer Vera already gave, so
    // whatever context that answer was built on is still the context here.
    if (clarificationCandidate && !isReplyToPriorTurn) {
      return res.json(clarificationCandidate);
    }

    // A real question arrived (not a pure context statement) and we now have
    // usable context but nothing persisted yet for this session — e.g. context
    // came from businessContext or sessionHistory rather than the DB. Persist
    // it now so it survives into future sessions too.
    if (effectiveBusinessContext && !storedContext) {
      await saveStoredBusinessContext(activeProfile, effectiveBusinessContext);
      addCompanyFact({ userId: sessionId, factText: effectiveBusinessContext, sourceType: "chat", profileId: activeProfile?.id ?? null }).catch(() => {});
    }

    // Classify BEFORE running any of the expensive retrieval/web-search work
    // below, so a narrow query can skip cost, not just get truncated after
    // the fact. See classifyQueryScope's comment for the full rationale —
    // this is what actually shrinks the prompt for the common "quick doubt"
    // case instead of relying on callGroqJSON's token clamp to react to an
    // already-oversized request after the fact.
    const queryScope = classifyQueryScope(body.data.message, body.data.sessionHistory);
    const isNarrowScope = queryScope === "narrow";

    // Fire-and-forget: persist this user turn to the permanent raw log (see
    // messageLog.ts / lib/db/src/schema/messages.ts) — the RAW LOG layer.
    // Keyed on userId regardless of chatId, so it's queryable across all of
    // this founder's chats later, never just this one thread.
    logMessage({ userId: sessionId, chatId: body.data.chatId, role: "user", content: body.data.message }).catch(() => {});

    // SESSION-SCOPED WORKING CONTEXT, sourced from the durable raw log
    // instead of the client-sent sessionHistory whenever a real chatId
    // exists. This is the actual fix for cross-topic bleed (e.g. an earlier
    // "draft a mail" turn leaking into a later, unrelated question):
    // getRelevantMessages keeps the most recent turns for coherence PLUS
    // only the older turns that are topically relevant to THIS message,
    // instead of dumping every recent turn regardless of topic. Falls back
    // to the client-sent sessionHistory when there's no chatId (e.g. an
    // anonymous/legacy call) so nothing regresses for that case.
    let serverHistory: { role?: string; content?: string }[] | undefined;
    if (body.data.chatId) {
      try {
        // keepRecent/topKRelevant tightened from 3/2 to 2/1 on the narrow
        // path — the free-tier TPM ceiling (8,000) is now smaller than
        // VENUS_SYSTEM_PROMPT alone (~6,900 est. tokens), so every token a
        // narrow follow-up spends on replayed history is a token the actual
        // answer can't have. A short follow-up needs enough of the last turn
        // to stay coherent, not a broader relevance-scored slice.
        const relevant = await getRelevantMessages(sessionId, body.data.chatId, body.data.message, {
          keepRecent: isNarrowScope ? 2 : 8,
          topKRelevant: isNarrowScope ? 1 : 6,
        });
        if (relevant.length > 0) {
          serverHistory = relevant.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch {
        // fall through to client-sent sessionHistory below
      }
    }
    const effectiveSessionHistory = serverHistory ?? body.data.sessionHistory;

    // Classification still resolves CONCURRENTLY with retrieval — it is just
    // started further up now (see classificationPromise) so the gates above
    // could consult it. Awaiting an already-in-flight promise here costs
    // nothing; on the ordinary path this is still one round-trip overlapped
    // with retrieval, exactly as before. Never rejects (see classifyQuery's
    // own catch), so Promise.all is safe here.
    //
    // It is classified against priorAssistantMessage (the true immediately
    // preceding turn from the client-sent history) rather than the last
    // assistant turn in effectiveSessionHistory, which is relevance-filtered
    // and reordered by getRelevantMessages and therefore need not be the turn
    // the founder is actually replying to. The correction log below uses the
    // same pair, so what gets recorded as a regression case is always the
    // exchange the classifier actually judged.
    const [retrieval, classification] = await Promise.all([
      retrievePrecedents(body.data.message, { businessContext: effectiveBusinessContext }),
      classificationPromise,
    ]);
    console.error(
      `[queryClassifier] session=${sessionId} kind=${classification.kind} complexity=${classification.complexity} needsExternalFacts=${classification.needsExternalFacts} corrects=${classification.correctsPriorAnswer} query="${body.data.message.slice(0, 120)}"`,
    );

    // The founder just told Vera its last answer was wrong. Capture the full
    // triple (question → answer → correction) as a permanent regression case.
    // Fire-and-forget: this is the learning loop, not something the founder
    // is waiting on, and it must never delay or break their actual reply.
    if (classification.correctsPriorAnswer) {
      console.error(
        `[responseFeedback] session=${sessionId} issueClass=${classification.issueClass} issue="${classification.detectedIssue ?? ""}" correction="${body.data.message.slice(0, 160)}"`,
      );
      recordCorrection({
        userId: sessionId,
        chatId: body.data.chatId,
        originalQuery: priorUserMessage,
        originalResponse: priorAssistantMessage,
        correctionText: body.data.message,
        detectedIssue: classification.detectedIssue,
        issueClass: classification.issueClass,
      }).catch(() => {});
    }

    // The founder's own resolved decision history — see retrieval.ts and
    // venus_decisions schema comments for why this is scoped per-session and
    // treated as stronger evidence than the third-party precedent dataset.
    // On a narrow query, only the single strongest match is worth the tokens
    // — a definition ask or one-line follow-up doesn't need three of them.
    const ownDecisionsRaw = await retrieveOwnResolvedDecisions(sessionId, body.data.message, { businessContext: effectiveBusinessContext });
    const ownDecisions = isNarrowScope ? ownDecisionsRaw.slice(0, 1) : ownDecisionsRaw;
    const ownHistoryBlock = ownDecisions.length > 0
      ? `YOUR OWN VERIFIED HISTORY WITH THIS FOUNDER (private to this founder, higher trust than the precedent dataset below):\n\n${formatOwnDecisionsForPrompt(ownDecisions)}`
      : "";

    // Open (not yet resolved) decisions from the last 45 minutes of this
    // same session — see retrieveOpenSessionDecisions for why this exists:
    // ownHistoryBlock above only catches a founder revising advice across
    // sessions once an outcome has been reported back, which means a
    // decision Venus made 2 messages ago in this same live conversation is
    // otherwise invisible to this check. This is what stops "1cr for 5% is
    // best" two turns after "50L for 5% is best" with no acknowledgment.
    const openSessionDecisions = await retrieveOpenSessionDecisions(sessionId);
    const openSessionBlock = openSessionDecisions.length > 0
      ? `OPEN RECOMMENDATIONS EARLIER THIS SESSION (not yet resolved — if the current message revises, contradicts, or proposes an alternative to one of these, you must reconcile explicitly rather than silently re-deriving a fresh verdict; if none of these relate to the current question, ignore this block):\n\n${formatOpenSessionDecisionsForPrompt(openSessionDecisions)}`
      : "";

    // Skipped on a narrow query, same reasoning as companyFacts/goalHistory
    // below: a quick follow-up doesn't need the full goal framing re-injected
    // on every turn — recent history already carries what's relevant. This
    // was previously the one memory/context block NOT gated by isNarrowScope,
    // meaning it was paid in full on every single message in a chat with an
    // active goal, including one-word replies.
    const goalBlock = isNarrowScope ? "" : await buildGoalPromptBlock(body.data.chatId);

    // ---- The founder's OTHER chats (see lib/chatMemory.ts) ----
    //
    // Everything above this line is scoped to THIS chat or to already-extracted
    // structure (the dossier, company_facts, resolved decisions). Nothing read
    // back what was actually SAID in the founder's other conversations, so a
    // new chat began with Vera unable to recall a conversation it had had —
    // reported live as "I don't have a record of our previous conversation"
    // about a chat that was two hours old and fully logged.
    //
    // Gated by scope EXCEPT on a recall question. isNarrowScope exists to
    // protect the TPM budget on quick follow-ups, and a follow-up inside a
    // chat genuinely doesn't need other chats — but "what did we decide last
    // time" is precisely the message that does, and it can classify narrow.
    // The recall path also gets a larger budget, because for that question
    // this block is not context supporting the answer, it IS the answer.
    //
    // The regex runs before the lookup so a narrow non-recall follow-up skips
    // the database round-trip entirely rather than paying for a result it
    // would discard.
    const isRecallQuestion = looksLikeRecallQuestion(body.data.message);
    const crossChatMemory =
      !isNarrowScope || isRecallQuestion
        ? await buildCrossChatMemory(sessionId, body.data.chatId, body.data.message, {
            charBudget: isRecallQuestion ? 1800 : 1100,
          })
        : null;
    const crossChatBlock = crossChatMemory?.block ?? "";
    if (crossChatBlock) {
      console.error(
        `[chatMemory] session=${sessionId} recall=${isRecallQuestion} chats=${crossChatMemory?.chatsUsed} chars=${crossChatBlock.length}`,
      );
    }

    // Everything stored about this founder that was previously write-only —
    // company_facts got written on every business-context statement (see
    // addCompanyFact calls above) but nothing ever read it back into a
    // prompt; buildGoalHistoryBlock closes the equivalent gap for resolved
    // goals. Skipped on a narrow query, same reasoning as ownDecisions/
    // precedents above: a quick follow-up doesn't need the founder's full
    // track record re-injected.
    // The company file (see lib/dossier.ts). Never gated by isNarrowScope:
    // it IS the structured picture of the business, so answering a quick
    // follow-up without it is answering about a company Vera has forgotten.
    // Resolved BEFORE company_facts because it decides what of that block is
    // still worth sending — see the de-duplication below.
    const dossierBlock = formatDossierForPrompt(await getDossier(sessionId, activeProfile?.id ?? null));

    // Everything stored about this founder that was previously write-only —
    // company_facts got written on every business-context statement (see
    // addCompanyFact calls above) but nothing ever read it back into a
    // prompt; buildGoalHistoryBlock closes the equivalent gap for resolved
    // goals. Skipped on a narrow query, same reasoning as ownDecisions/
    // precedents above: a quick follow-up doesn't need the founder's full
    // track record re-injected.
    //
    // DE-DUPLICATED AGAINST THE DOSSIER. Completing intake writes every
    // dossier field into company_facts as well (see the dossier route's
    // syncDossierToMemory — they belong there so each one stays individually
    // correctable and visible on the memory page). Without this filter those
    // same facts then arrive in the prompt TWICE: once as the company file,
    // once as structured facts. On a budget the static system prompt already
    // consumes in full, paying twice for identical content is paid for by
    // cutting the grounding material at the other end of the shrink. The
    // dossier is the better-shaped copy — labelled, ordered, complete — so
    // it wins and the onboarding-sourced rows drop out. Facts learned from
    // CHAT are untouched: those are genuinely newer than the file.
    const allCompanyFacts = isNarrowScope ? [] : await getActiveCompanyFacts(sessionId, 8, activeProfile?.id);
    const companyFacts = dossierBlock
      ? allCompanyFacts.filter((f) => f.sourceType !== "onboarding")
      : allCompanyFacts;
    const companyFactsBlock = companyFacts.length > 0
      ? `STRUCTURED FACTS VENUS HAS LEARNED ABOUT THIS FOUNDER'S BUSINESS (individually captured and correctable, higher-confidence than the freeform Business Context line below; facts tagged "user-reported" are the founder's own claim — reason from them but never restate them back as independently established fact):\n${formatCompanyFactsForPrompt(companyFacts)}`
      : "";
    // Standing preferences ("no em-dashes," "keep answers short") are pulled
    // regardless of isNarrowScope/topic — unlike business facts above, a
    // style rule must apply to every future task, not just a topically
    // similar one (see companyMemory.getActivePreferenceFacts).
    const preferenceFacts = await getActivePreferenceFacts(sessionId, 10);
    const preferenceFactsBlock = preferenceFacts.length > 0
      ? `STANDING PREFERENCES THIS FOUNDER HAS ASKED VENUS TO ALWAYS FOLLOW (apply to every response below, regardless of topic):\n${formatPreferenceFactsForPrompt(preferenceFacts)}`
      : "";
    const goalHistoryBlock = isNarrowScope ? "" : await buildGoalHistoryBlock(sessionId);

    // Closes the correction loop. recordCorrection (further up) has been
    // writing every correction to response_feedback for a while, but nothing
    // in the codebase ever read that table back into a prompt — so the
    // capture was real and the learning was not. Pulled regardless of query
    // scope, for the same reason as standing preferences: "you got this
    // wrong before" applies to the next answer whatever its topic, and this
    // founder correcting Vera twice on the same thing is the exact
    // experience that makes an advisor feel replaceable.
    const pastCorrections = await getRecentCorrections(sessionId, isNarrowScope ? 2 : 4);
    const correctionHistoryBlock = formatCorrectionsForPrompt(pastCorrections);

    const memoryBlock =`${companyFactsBlock ? `\n\n${companyFactsBlock}` : ""}${preferenceFactsBlock ? `\n\n${preferenceFactsBlock}` : ""}${correctionHistoryBlock ? `\n\n${correctionHistoryBlock}` : ""}${goalHistoryBlock ? `\n\n${goalHistoryBlock}` : ""}`;

    // Whether this turn carries files at all — cheap, synchronous, and needed
    // BEFORE the web search decision below. The block itself is built much
    // further down, once the prompt's real size is known (see
    // attachmentCharBudget).
    const hasAttachment = parseAttachmentMarkers(body.data.message).length > 0;

    const isModerate = retrieval.tier === "moderate";
    const isNone = retrieval.tier === "none";

    // Item 5: a query that reads as a factual/external lookup (see
    // FACTUAL_EXTERNAL_QUERY above) deserves a real search even when it
    // would otherwise be skipped — either because it accidentally cleared a
    // "moderate" precedent-tier match on generic vocabulary (a likely
    // false-positive per .agents/memory/retrieval-gating-lexical-overlap.md,
    // not genuine relevance to a product-review-style question), or because
    // it got classified narrow. Never overrides "strong" tier — a direct
    // curated-dataset match stays authoritative there.
    // Was: FACTUAL_EXTERNAL_QUERY.test(...) — a keyword regex that could only
    // match enumerated phrasings and missed the failure it was written to
    // catch (see queryClassifier.ts). Now a real classification of what the
    // question needs, which generalizes to phrasings nobody anticipated.
    const isFactualExternal =
      classification.kind === "factual_lookup" ||
      classification.kind === "mixed" ||
      classification.needsExternalFacts ||
      // FAIL OPEN. When classification didn't succeed, we do not know whether
      // this question needs real sources — so search rather than assume it
      // doesn't. Assuming it doesn't is what produces an invented answer, and
      // it would do so exactly when the system is already degraded. An
      // unnecessary search costs latency; a skipped one costs correctness.
      classification.failed;

    // No verified precedent in the curated dataset doesn't mean "give up" — it
    // means go find real information instead. This is fully generic: whatever
    // the user asked about (a named app, a niche concept, anything), the raw
    // message itself is the search query. Never special-cased to any topic.
    // Skipped on a narrow query: a plain definition ask ("what's a SAM?") or
    // a short follow-up referring back to the last turn doesn't need a fresh
    // web search — it needs the term explained or the prior context
    // clarified, both of which the model can do from general knowledge and
    // the (still-included) recent history. This also removes a real network
    // round-trip from the narrow-query path, not just tokens. EXCEPT when
    // isFactualExternal fires — a genuine external-fact question overrides
    // both the "moderate tier is good enough" and "narrow skips search"
    // defaults, since answering it from stale model memory instead of a live
    // source is exactly the failure this item exists to close.
    // A factual lookup ALWAYS gets a live search, at every retrieval tier.
    // The old gate only searched at tier "none" (or "moderate" + regex hit),
    // which meant a precedent match — even one earned entirely on the
    // founder's business context rather than the question (see retrieval.ts)
    // — actively SUPPRESSED the search and left the model to invent the
    // facts. Precedents are startup case studies; they can never be the
    // source for "what real schools exist in Mumbai", so a precedent match is
    // irrelevant to whether a factual question needs grounding.
    // Skipped outright when the founder attached a file. The evidence for
    // "what does my P&L say" is the P&L, not DuckDuckGo — and on the free
    // tier the search block is hundreds of tokens taken directly out of the
    // room the document needs (see attachmentCharBudget below). This is the
    // one case where suppressing the search costs nothing in grounding:
    // there is a better, first-party source already in the prompt.
    const webResult = (!hasAttachment && (isFactualExternal || (isNone && !isNarrowScope)))
      ? await webSearch(body.data.message)
      : null;
    const webSearchBlock = webResult ? formatWebSearchForPrompt(webResult) : "";

    // Narrow queries keep at most the single strongest precedent instead of
    // the full top-4 — same reasoning as ownDecisions above: a quick doubt
    // doesn't need four dense precedent blocks to be answered well, and the
    // model still gets one grounded example rather than none.
    const precedentMatches = isNarrowScope ? retrieval.precedents.slice(0, 1) : retrieval.precedents;
    const precedentBlock = `VERIFIED PRECEDENTS (retrieved from curated dataset, confidence ${retrieval.confidence}, tier: ${retrieval.tier}):\n\n${formatPrecedentsForPrompt(precedentMatches)}`;

    // Both shadow-mode instructions (extractedFacts — fact-conflict
    // detection, and evidenceConvergence — hypotheses/contradictions) are
    // only requested for non-narrow queries — narrow follow-ups are exactly
    // where the TPM budget is already tightest. See groq.ts's comments on
    // each constant for their measured cost.
    //
    // evidenceConvergence is additionally sampled rather than sent on every
    // eligible request: real production logs on 2026-07-22 showed a broad-
    // scope request at ~10,354 estimated prompt tokens — already over the
    // ~6,800-token real budget before either shadow-mode addition — hitting
    // clampMaxTokensToTpmBudget's floor and then a 413 shrink/retry loop,
    // and the org separately hit its 200,000/day Groq quota the same day.
    // evidenceConvergence (~588 measured tokens, the larger of the two) is
    // pure calibration overhead with no user-facing value yet, so it's the
    // right lever to cut first rather than pausing calibration entirely —
    // a ~15% sample still yields a real, if slower-growing, dataset for the
    // manual review this was built for. Revisit this rate once that review
    // happens; if [callGroqJSON] clamp/413 warnings on broad-scope requests
    // don't drop noticeably, evidenceConvergence wasn't the marginal cause
    // and this sampling isn't the fix that's needed.
    const EVIDENCE_CONVERGENCE_SAMPLE_RATE = 0.15;
    // BOTH shadow-mode blocks are now suspended on the free tier. They are
    // pure calibration overhead — the model spends tokens producing
    // extractedFacts/evidenceConvergence, both of which are logged and then
    // deleted from the response (see the delete/finally blocks below); no
    // founder ever sees either. Measured, they cost ~166 and ~588 tokens.
    //
    // That was an acceptable trade when the budget had slack. It doesn't now:
    // the static system prompt alone (~6,900 est. tokens) already exceeds the
    // entire free-tier TPM budget (8,000 × 0.85 = 6,800), so every broad query
    // is clamped to the MIN_USABLE_MAX_TOKENS floor and then shrink-retried,
    // which cuts real grounding content and truncates the JSON answer. Paying
    // calibration tokens out of that deficit directly degrades the answer the
    // founder actually reads. Re-enables automatically on the paid tier, where
    // the headroom exists again — no code change needed, just the env var.
    const collectCalibrationData = process.env.GROQ_PAID_TIER === "true";
    const includeEvidenceConvergence =
      collectCalibrationData && !isNarrowScope && Math.random() < EVIDENCE_CONVERGENCE_SAMPLE_RATE;
    const shadowModeInstructions = `${collectCalibrationData && !isNarrowScope ? EXTRACTED_FACTS_INSTRUCTION : ""}${includeEvidenceConvergence ? EVIDENCE_CONVERGENCE_INSTRUCTION : ""}`;
    // Deliberately NOT baked into venusPromptForTier (which sits right after
    // the protected VENUS_PROMPT head) — appended to the very end of the
    // whole systemPrompt below instead. groq.ts's shrinkMessages keeps the
    // FRONT of the system message's dynamic tail and cuts from the end on a
    // 413 retry, so position here is a real priority signal, not cosmetic:
    // shadowModeInstructions is pure calibration overhead with zero founder
    // -facing value, so it should be the FIRST thing sacrificed on a shrink
    // — not sit ahead of historyContext/precedentBlock, which actually
    // carry the grounding a response needs to be correct.
    // The other half of the correction fix. Routing (see the answer-
    // withholding gate guard above) only decides that a correction REACHES
    // the model; this decides what happens once it gets there. Until now
    // correctsPriorAnswer was computed, logged to response_feedback for
    // offline evals, and then dropped before prompt assembly — the model was
    // never told it was being corrected, so it answered as if the message
    // were an ordinary question. Observed live: immediately after "im
    // correcting u", Vera re-issued its rejected recommendation nearly
    // verbatim behind an agreeable "Yes, ..." opener.
    //
    // Appended to venusPromptForTier, i.e. the very FRONT of the system
    // message's dynamic tail, because groq.ts's shrinkMessages cuts from the
    // end on a 413 retry. A correction must survive a shrink: it changes what
    // the answer IS, not how richly that answer is supported.
    const correctionInstruction = classification.correctsPriorAnswer
      ? buildCorrectionInstruction(classification.detectedIssue, classification.issueClass)
      : "";
    // Only the prompt sections this request can actually use (see
    // buildVenusPrompt in groq.ts for the full reasoning). The static prompt
    // used to be sent whole on every call at ~7,000 tokens against a 6,800
    // -token free-tier budget — over the ceiling before any context or output
    // existed, which is precisely the "TPM limit hit / can't respond"
    // failure. Nothing is rewritten or weakened here: the strategy path still
    // gets the entire causal-reasoning stack, it just stops carrying the
    // drafting and capability blocks that a strategy answer can never use.
    //
    // The drafting block is ORed in on a keyword check as well as the
    // classification. The classifier generalizes where a regex can't, but it
    // isn't infallible, and the two failure costs are wildly asymmetric: a
    // missed drafting request means a full LinkedIn post silently capped at
    // "3-5 plain sentences" (the founder's deliverable, mangled), while a
    // false positive costs ~618 tokens on a request that has ~1,000 spare.
    // So this deliberately over-includes.
    // Targeted, not maximally greedy: bare "post", "copy" and "word" were
    // tried and pulled in far too much ordinary strategy vocabulary
    // ("should I post about this", "copy that competitor", "how do I word
    // this") — each false positive spends ~618 tokens out of the ~1,000 a
    // strategy request has spare, which is the budget this change is
    // supposed to be protecting. These stems only fire on an actual ask for
    // written output.
    const looksLikeDrafting =
      /\b(draft|rewrite|caption|script|tweet|newsletter|blurb|talking points)\b/i.test(body.data.message) ||
      /\bwrite\s+(me|a|an|up|the)\b/i.test(body.data.message);
    const buildPromptFor = (mode: VenusResponseMode) =>
      buildVenusPrompt({
        mode,
        includeDrafting: looksLikeDrafting,
        // A rule explaining how to read a block is dead weight when the block
        // itself isn't in the prompt — and these two are absent far more often
        // than they're present.
        hasOwnHistory: Boolean(ownHistoryBlock),
        hasOpenSession: Boolean(openSessionBlock),
        hasCrossChat: Boolean(crossChatBlock),
      });

    // Typed as the PROMPT's mode union, not the classifier's — "document" is
    // a budget decision made below, and is deliberately not something the
    // classifier can choose.
    let responseMode: VenusResponseMode = classification.responseMode;
    let venusPromptBase = buildPromptFor(responseMode);
    let venusPromptForTier = (isModerate ? `${venusPromptBase}${MODERATE_TIER_PRECEDENT_NOTE}` : venusPromptBase) + correctionInstruction;

    // ---- How much room this request actually has for file contents ----
    //
    // Built HERE, not up with the other context blocks, because this is the
    // first point where the prompt's real size is known. A fixed 8,000-char
    // attachment budget (what this used to be) is ~2,000 tokens on a free
    // tier whose entire usable budget is 6,800 and whose strategy prompt
    // alone is ~5,849 — so every request carrying a readable document went
    // over the ceiling, exhausted createWithRetry's shrink passes and came
    // back as the generic "Vera couldn't answer that right now". Measuring
    // instead of guessing is the difference between a thin answer and no
    // answer.
    //
    // Everything countable at this point is counted. The blocks assembled
    // after this (grounding guard, follow-up/routing/no-precedent
    // instructions) are covered by a flat reserve rather than being moved
    // around, and MIN_USABLE_MAX_TOKENS reserves room for the ANSWER — the
    // thing most easily forgotten, since Groq charges TPM on prompt plus the
    // requested completion.
    const LATE_INSTRUCTION_RESERVE_TOKENS = 700;
    const historyTokenEstimate = (effectiveSessionHistory ?? [])
      .slice(-(isNarrowScope ? 2 : 10))
      .reduce((sum: number, h: { content?: string }) => sum + estimateTokens(h.content ?? ""), 0);
    const tpmBudgetTokens = Math.floor(tpmLimitForModel(ANALYZE_MODEL) * TPM_SAFETY_MARGIN);
    const fileBudgetFor = (promptText: string) =>
      tpmBudgetTokens -
      (estimateTokens(promptText) +
        estimateTokens(webSearchBlock) +
        estimateTokens(isNone ? "" : precedentBlock) +
        estimateTokens(dossierBlock) +
        estimateTokens(effectiveBusinessContext ?? "") +
        estimateTokens(ownHistoryBlock) +
        estimateTokens(openSessionBlock) +
        estimateTokens(crossChatBlock) +
        estimateTokens(goalBlock) +
        estimateTokens(memoryBlock) +
        estimateTokens(shadowModeInstructions) +
        estimateTokens(body.data.message) +
        historyTokenEstimate) -
      LATE_INSTRUCTION_RESERVE_TOKENS -
      MIN_USABLE_MAX_TOKENS;

    let attachmentTokenBudget = fileBudgetFor(venusPromptForTier);

    // ---- When the file and the reasoning stack can't both fit, the file wins
    //
    // On the free tier this is not a close call: strategy mode is ~5,849
    // tokens of a ~6,800-token budget, so a document-bearing request has
    // NEGATIVE room for the document. The old behaviour was to send it
    // anyway, blow the ceiling, exhaust the shrink retries and return "Vera
    // couldn't answer that right now" — the founder lost both the reasoning
    // AND the file.
    //
    // Reading the founder's actual P&L is worth more than the scaffold used
    // to interrogate a P&L you cannot see, so below the threshold the prompt
    // drops to core+cards and the freed ~4,100 tokens go to the file. Applies
    // ONLY to turns that carry a file, and only when the budget forces it —
    // on the paid tier there is room for both and this never fires, with no
    // code change needed.
    const MIN_WORTHWHILE_FILE_TOKENS = 500;
    if (hasAttachment && attachmentTokenBudget < MIN_WORTHWHILE_FILE_TOKENS && responseMode !== "drafting") {
      const documentPrompt = buildPromptFor("document");
      const documentModeBudget = fileBudgetFor(documentPrompt);
      // Only swap if it actually buys enough room to be worth the trade —
      // giving up the reasoning stack and STILL not fitting the file would be
      // the worst of both.
      if (documentModeBudget >= MIN_WORTHWHILE_FILE_TOKENS) {
        console.error(
          `[promptMode] session=${sessionId} switching ${responseMode} -> document: file budget ${attachmentTokenBudget}t -> ${documentModeBudget}t (free-tier TPM; set GROQ_PAID_TIER=true to keep the full stack)`,
        );
        responseMode = "document";
        venusPromptBase = documentPrompt;
        venusPromptForTier = (isModerate ? `${venusPromptBase}${MODERATE_TIER_PRECEDENT_NOTE}` : venusPromptBase) + correctionInstruction;
        attachmentTokenBudget = documentModeBudget;
      }
    }

    console.error(
      `[promptMode] session=${sessionId} mode=${responseMode} drafting=${looksLikeDrafting} classifierFailed=${classification.failed} promptTokens~${estimateTokens(venusPromptBase)}`,
    );
    const attachmentCharBudget = Math.max(0, attachmentTokenBudget * 4);

    // Attached files. NEVER gated by isNarrowScope, and deliberately placed
    // at the front of the dynamic tail below rather than in memoryBlock: if
    // this is ever dropped by a shrink retry, the model is back to seeing a
    // bare "[Attached file: x.png]" marker with nothing telling it the file
    // is unreadable — which is precisely the state that produced confident
    // analysis of never-opened files. See lib/attachmentContext.ts.
    const attachmentBlock = hasAttachment
      ? await buildAttachmentBlock(sessionId, body.data.chatId, body.data.message, attachmentCharBudget)
      : "";
    if (hasAttachment) {
      console.error(
        `[attachmentBudget] session=${sessionId} fileBudget=${attachmentCharBudget}chars (~${attachmentTokenBudget}t) mode=${responseMode} paidTier=${process.env.GROQ_PAID_TIER === "true"}`,
      );
    }
    // REMOVED: historyContext, which rendered the last 8 turns as a text blob
    // inside the system prompt. The SAME turns are already sent as real,
    // role-tagged chat messages further down (see messageHistoryTurnCount's
    // push loop) — so every conversation was transmitted TWICE, once as
    // flattened "User:/Assistant:" prose and once properly structured.
    //
    // Dropping the blob costs nothing semantically (not one turn of context is
    // lost — the structured copy is strictly better, since the model reads
    // role-tagged turns natively) and returns ~400-900 tokens per request to
    // the budget the answer itself is starved for. Duplicated context also
    // actively dilutes attention, so this should read as slightly sharper, not
    // just cheaper.
    const followUpInstruction = `Conversation routing: narrow follow-up → answer directly and narrowly, at most one supporting card. Broad question → full template, cards only for facets that genuinely need one (not a default 2+). Either way, earlier turns in this conversation are background only — never treat an earlier turn's request, including a past draft, as pending action this turn unless the current message asks for it.`;
    const decisionRoutingInstruction = buildDecisionRoutingInstruction(body.data.message);
    // Keyed on whether webResult actually ran, not on isNarrowScope directly
    // — Item 5's isFactualExternal override means a narrow query can still
    // get a real search (see webResult assignment above), and the
    // instruction text below must not claim a search ran when it didn't, or
    // claim none ran when one actually did (either way, the model might
    // reference a "WEB SEARCH RESULTS" section incorrectly).
    // The named-entity guard is NOT interpolated into either branch below —
    // it used to be baked in here AND appended again via
    // groundingInstructions, so every isNone-tier query paid for the same
    // ~283-token block twice for zero behavioral benefit.
    // groundingInstructions alone now carries it, exactly once.
    const noPrecedentInstruction = !webResult
      ? `NO VERIFIED PRECEDENT MATCH IN CURATED DATASET: This request doesn't match anything in the verified precedent dataset — that's fine, it just means you can't cite a dataset company/outcome as verified precedent. It does NOT mean you should refuse, hedge into an error, or ask the user to rephrase. This looks like a quick clarification or definition-style question, so no web search was run for it — answer directly from your own general knowledge, staying specific and concrete rather than vague. The confidence badge already shown elsewhere in the UI marks this response as exploratory/unverified, so you do NOT need to repeat a big warning inside your answer. Never fabricate a precedent-style company outcome as if it came from the curated dataset — anything you use from general knowledge is reasoning, not a "Precedent" card.`
      : `NO VERIFIED PRECEDENT MATCH IN CURATED DATASET: This request doesn't match anything in the verified precedent dataset — that's fine, it just means you can't cite a dataset company/outcome as verified precedent. It does NOT mean you should refuse, hedge into an error, or ask the user to rephrase. A live web search was run for this query (see WEB SEARCH RESULTS below); use whatever real information it surfaced — names, facts, figures, how something actually works — to give a direct, specific, useful answer. If the web search came back empty, fall back to general strategic reasoning instead — do NOT invent specific real-world names/figures to fill the gap. The confidence badge already shown elsewhere in the UI marks this response as exploratory/unverified, so you do NOT need to repeat a big warning inside your answer — a brief natural mention that this isn't from the verified dataset is enough, stated plainly rather than as a disclaimer wall. Never fabricate a precedent-style company outcome as if it came from the curated dataset — anything you use from web search or general knowledge is reasoning, not a "Precedent" card.`;

    // Now shared with /ai/idea-review and the company-autopsy route via
    // groq.ts — see buildGroundingInstructions there for why a per-route
    // copy of this was itself the bug. Applies at EVERY retrieval tier:
    // previously the guard lived only inside noPrecedentInstruction, which
    // is only assembled when tier === "none", so a query that matched a
    // precedent (including one matched purely on the founder's business
    // context) got no grounding guard at all. That was the exact hole the
    // fabricated-schools answer went through: tier "moderate", guard absent,
    // search suppressed.
    const groundingInstructions = buildGroundingInstructions(isFactualExternal);
    // webSearchBlock is no longer tied to the isNone branch either — a factual
    // lookup now searches at any tier (see webResult above), so the results
    // must be included wherever they exist or the model would be told a search
    // ran and then never shown it.

    // WAS three near-identical template literals (isNone / has-context /
    // no-context) differing only in whether the precedent block or the
    // no-precedent instruction appeared, and where the Business Context line
    // sat. Three copies of one prompt is a divergence hazard of exactly the
    // kind this file has already been bitten by: namedEntityGuard once lived
    // in only one of the branches, so a whole tier of queries got no
    // grounding guard at all (see the comment above groundingInstructions).
    // One ordered list, assembled once, makes "is this block in every
    // branch?" un-askable — a block is either in the list or it is not.
    //
    // Order IS the priority signal: groq.ts's shrinkMessages keeps the front
    // of the dynamic tail and cuts from the end on a 413 retry. Attachments
    // sit near the front because losing that block means the model silently
    // reverts to assuming it can read a file it has never opened.
    /* ------------------------------------------------------------------
       PRE-FLIGHT BUDGET ENFORCEMENT — fit the request BEFORE sending it.

       WHY THIS EXISTS, AND WHY THE TPM WALL CAME BACK AFTER BEING FIXED.
       The per-request prompt assembly (buildVenusPrompt, added 2026-08-14)
       fixed the STATIC half of this problem and still works. But measured
       against the real free-tier budget of 6,800 tokens:

         strategy, static ....................... 5,849 t
         strategy + the memory rule blocks
         (ownHistory + openSession + crossChat) . 6,421 t
         ...and MIN_USABLE_MAX_TOKENS on top ..... 7,621 t  ← over, alone

       Strategy mode was always sitting at ~86% of the entire budget before
       any context existed. Worse, Groq charges TPM on prompt tokens PLUS the
       requested completion, so the 1,200-token answer reservation counts too:
       5,849 + 1,200 = 7,049 is ALREADY over 6,800 with zero context, zero
       dossier, zero precedents and an empty message. Full strategy mode does
       not fit the free tier at all, and no arrangement of the founder's data
       makes it fit — see groq.budget.test.mjs, which pins that fact.

       What held before was that the classifier routed most messages to the
       lighter modes, and the memory blocks were EMPTY.

       Cross-chat memory shipped 2026-08-17. It does not add tokens on the
       day it ships — it adds them once the founder HAS other chats to
       recall. Same for ownHistory, openSession, goals and the dossier: every
       one of them is empty for a new account and grows as the product gets
       used. So the budget regressed WITHOUT ANY CODE CHANGE, which is
       exactly why this felt like it "went back on its own". A realistic
       strategy request for a founder with real history now measures ~10,240
       tokens against 6,800 — over by ~3,440.

       WHAT WAS MISSING. The budget was already MEASURED here (fileBudgetFor
       above) but only ACTED ON when the request carried an attachment.
       Without one, an over-budget request was simply sent: Groq 413s,
       shrinkMessages cuts blocks blindly from the end, and the founder pays
       a wasted round trip to get a thinner answer — or "Vera couldn't answer
       that right now".

       WHAT THIS DOES. Sheds optional blocks in a defined order until the
       request fits, before it is sent. Same lever shrinkMessages pulls, one
       round trip earlier and with the priorities stated rather than implied
       by array position.

       WHAT IS NEVER SHED, and this is the important half: the dossier and
       the business context. They are the answer to "who is this founder",
       and dropping them is what makes Vera ask a founder what their business
       does for the fourth time. Precedents and third-party examples go
       first; the founder's own identity goes last. If everything optional is
       gone and it still does not fit, the REASONING STACK yields — the same
       trade the attachment path already makes above, for the same reason: an
       answer grounded in this founder's real business beats a richer
       scaffold applied to a business Vera has forgotten.
    ------------------------------------------------------------------ */
    type Sheddable = { name: string; text: string };
    // Ordered LEAST valuable first — this is the order they are given up in.
    const optionalBlocks: Sheddable[] = [
      { name: "goals", text: goalBlock },
      { name: "openSession", text: openSessionBlock },
      { name: "ownHistory", text: ownHistoryBlock },
      { name: "precedents", text: isNone ? "" : precedentBlock },
      { name: "memory", text: memoryBlock },
      { name: "crossChat", text: crossChatBlock },
      { name: "webSearch", text: webSearchBlock },
    ];
    const shed = new Set<string>();
    const keptText = (name: string, text: string) => (shed.has(name) ? "" : text);

    // Everything that is NOT sheddable, plus the answer we have to leave room
    // for. Groq charges TPM on prompt tokens PLUS the requested max_tokens.
    const fixedTokens = () =>
      estimateTokens(venusPromptForTier) +
      estimateTokens(attachmentBlock) +
      estimateTokens(followUpInstruction) +
      estimateTokens(decisionRoutingInstruction) +
      estimateTokens(isNone ? noPrecedentInstruction : "") +
      estimateTokens(groundingInstructions) +
      estimateTokens(dossierBlock) +
      estimateTokens(effectiveBusinessContext ?? "") +
      estimateTokens(shadowModeInstructions) +
      estimateTokens(body.data.message) +
      historyTokenEstimate +
      MIN_USABLE_MAX_TOKENS;

    const currentTotal = () =>
      fixedTokens() + optionalBlocks.reduce((sum, b) => sum + estimateTokens(keptText(b.name, b.text)), 0);

    const startingTotal = currentTotal();
    for (const block of optionalBlocks) {
      if (currentTotal() <= tpmBudgetTokens) break;
      if (!block.text) continue;
      shed.add(block.name);
    }

    // Last resort: the reasoning stack itself. Only when shedding every
    // optional block was still not enough — which on the free tier means the
    // static strategy prompt (5,849 t) plus this founder's own context
    // genuinely cannot coexist. open_ended keeps Vera answering as Vera
    // (~2,036 t) rather than dropping to the near-bare document mode.
    let downgradedFrom: string | null = null;
    if (currentTotal() > tpmBudgetTokens && responseMode === "strategy") {
      const leaner = buildPromptFor("open_ended");
      const leanerForTier = (isModerate ? `${leaner}${MODERATE_TIER_PRECEDENT_NOTE}` : leaner) + correctionInstruction;
      if (estimateTokens(leanerForTier) < estimateTokens(venusPromptForTier)) {
        downgradedFrom = responseMode;
        responseMode = "open_ended";
        venusPromptBase = leaner;
        venusPromptForTier = leanerForTier;
        // Shedding is re-run: the freed ~3,800 tokens may buy back blocks
        // that were given up a moment ago, and grounding is worth more than
        // a scaffold. Cheapest-first this time, so the most valuable
        // survivors are reinstated.
        shed.clear();
        for (const block of optionalBlocks) {
          if (currentTotal() <= tpmBudgetTokens) break;
          if (!block.text) continue;
          shed.add(block.name);
        }
      }
    }

    if (shed.size > 0 || downgradedFrom) {
      console.error(
        `[promptBudget] session=${sessionId} start=${startingTotal}t final=${currentTotal()}t budget=${tpmBudgetTokens}t` +
          `${downgradedFrom ? ` downgraded=${downgradedFrom}->${responseMode}` : ""}` +
          `${shed.size ? ` shed=${[...shed].join(",")}` : ""}` +
          ` (free-tier TPM; set GROQ_PAID_TIER=true once billing is live to stop shedding)`,
      );
    }

    const systemPrompt =
      [
        venusPromptForTier,
        attachmentBlock,
        followUpInstruction,
        decisionRoutingInstruction,
        isNone ? noPrecedentInstruction : "",
        groundingInstructions,
        keptText("webSearch", webSearchBlock),
        dossierBlock,
        // Kept alongside the dossier rather than replaced by it: the blob
        // still carries anything said in chat since the file was last
        // updated. The dossier is placed FIRST so that where the two
        // disagree, the structured, founder-confirmed field is what the
        // model reads as authoritative.
        effectiveBusinessContext ? `Business Context: ${effectiveBusinessContext}` : "",
        // Placed ABOVE the precedent dataset deliberately. shrinkMessages cuts
        // from the end of this list on a 413 retry, and these are records of
        // what this founder actually said, where precedents are third-party
        // case studies — on a recall question, losing this block turns the
        // answer into the exact "I have no record of that" denial this exists
        // to end, while losing a precedent costs one supporting example.
        keptText("crossChat", crossChatBlock),
        keptText("precedents", isNone ? "" : precedentBlock),
        keptText("ownHistory", ownHistoryBlock),
        keptText("openSession", openSessionBlock),
        keptText("goals", goalBlock),
      ]
        .filter(Boolean)
        .join("\n\n") +
      keptText("memory", memoryBlock) +
      shadowModeInstructions; // appended LAST — see shrinkMessages: least protected, first cut on a shrink retry

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    // Mirrors historyTurnCount above — the raw message history sent as
    // actual chat turns shrinks the same way the text summary in
    // historyContext does, for the same reason: a narrow follow-up doesn't
    // need 10 prior turns replayed as messages to be answered correctly.
    // 4 -> 2: same free-tier budget pressure as the getRelevantMessages
    // tightening above — each replayed turn is real tokens the narrow-path
    // budget doesn't have room for anymore.
    const messageHistoryTurnCount = isNarrowScope ? 2 : 10;
    if (effectiveSessionHistory && effectiveSessionHistory.length > 0) {
      for (const h of effectiveSessionHistory.slice(-messageHistoryTurnCount)) {
        if (h.content) {
          const role = h.role === "user" ? "user" : "assistant";
          messages.push({ role, content: h.content });
        }
      }
    }

    // A correction is meaningless without the turn it corrects. The history
    // above is relevance-filtered and length-capped (getRelevantMessages +
    // the slice), neither of which knows this particular turn is load-bearing
    // — so on a narrow-scope correction, or one where the prior answer scored
    // poorly on topical relevance, the model could receive
    // correctionInstruction with nothing in context to apply it to. Restore
    // the exchange explicitly when it's missing, immediately before the
    // current message so it reads as the turn being replied to.
    if (classification.correctsPriorAnswer && priorAssistantMessage) {
      const alreadyPresent = messages.some((m) => m.content === priorAssistantMessage);
      if (!alreadyPresent) {
        if (priorUserMessage && !messages.some((m) => m.content === priorUserMessage)) {
          messages.push({ role: "user", content: priorUserMessage });
        }
        messages.push({ role: "assistant", content: priorAssistantMessage });
      }
    }

    messages.push({ role: "user", content: body.data.message });

    // Previously a flat guess (1800 narrow / 6000 broad) with no relation to
    // the real prompt size or the real TPM ceiling. On gpt-oss-120b's true
    // free-tier 8,000 TPM (see .agents/memory/groq-scout-deprecation-2026-07.md
    // and groq.ts's GROQ_TPM_LIMIT_BY_MODEL), 6000 alone is already close to
    // the entire ceiling before a single token of the actual prompt is
    // counted — meaning almost every broad-scope call arrived at
    // clampMaxTokensToTpmBudget already needing correction, and often needed
    // one or more shrink-and-retry cycles in createWithRetry just to fit at
    // all. Each retry cuts real message content, which is what was
    // producing thin, truncated, or unparseable responses that fell through
    // to buildShortQueryFallback — a visible quality regression that was
    // actually a budgeting bug, not a reasoning-quality regression from the
    // system prompt compression.
    //
    // This computes the real available budget from the messages array that
    // now actually exists (system prompt + history + business context +
    // precedent block + the founder's message), using the exact same
    // estimateTokens/tpmLimitForModel/TPM_SAFETY_MARGIN math
    // clampMaxTokensToTpmBudget already applies inside callGroqJSON — so the
    // first attempt asks for a number it can realistically get, and
    // clamping/retrying becomes the rare exception again instead of the
    // normal path on every broad query.
    const estimatedPromptTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const tpmBudget = Math.floor(tpmLimitForModel(ANALYZE_MODEL) * TPM_SAFETY_MARGIN);
    const realisticCeiling = Math.max(MIN_USABLE_MAX_TOKENS, tpmBudget - estimatedPromptTokens);
    // Still respect the narrow/broad intent — a narrow follow-up genuinely
    // doesn't need a huge response even when the budget could technically
    // allow one — but never request more than what's actually available.
    const requestedMaxTokens = Math.min(isNarrowScope ? 1800 : 6000, realisticCeiling);

    // ADAPTIVE REASONING DEPTH. groq.ts pins reasoning_effort to "low" for
    // every call by default — a truncation workaround (hidden reasoning
    // tokens are drawn from the SAME max_tokens budget as the visible JSON)
    // that silently became a global reasoning-quality ceiling. A risk
    // assessment and a one-line definition were being thought about equally
    // hard, which is the direct cause of complex questions coming back
    // shallow while simple ones look fine.
    //
    // Raising it is gated on ACTUAL HEADROOM, not just on the question being
    // hard, because on the free tier the two goals genuinely conflict: with
    // max_tokens clamped near MIN_USABLE_MAX_TOKENS, extra reasoning tokens
    // come straight out of the JSON answer and truncate the cards. So depth
    // only increases when there is real room to spend, and the headroom check
    // is deliberately generous (2x the floor) so this can never be the cause
    // of a truncated response. On the free tier that means it will rarely
    // fire on broad queries today; once GROQ_PAID_TIER is live the headroom
    // exists and complex questions start getting genuinely deeper reasoning
    // with no further code change.
    const REASONING_HEADROOM_TOKENS = MIN_USABLE_MAX_TOKENS * 2;
    const hasReasoningHeadroom = requestedMaxTokens >= REASONING_HEADROOM_TOKENS;
    const adaptiveReasoningEffort: "low" | "medium" | "high" =
      !hasReasoningHeadroom || classification.complexity === "simple"
        ? "low"
        : classification.complexity === "complex"
          ? "high"
          : "medium";
    if (adaptiveReasoningEffort !== "low") {
      console.error(
        `[reasoningDepth] session=${sessionId} effort=${adaptiveReasoningEffort} complexity=${classification.complexity} maxTokens=${requestedMaxTokens}`,
      );
    }

    const { parsed } = await callGroqJSON(
      groq,
      // 3000 was tuned against short prompts. A broad/descriptive query can
      // legitimately ask for a decision card plus several supporting cards
      // (market, risk, roadmap, precedent) — that alone runs well past 3000
      // tokens of JSON before reasoning is even counted, which is what was
      // producing truncated JSON and the generic "couldn't answer" fallback
      // on longer prompts. 6000 gives real headroom for a full multi-card
      // response; reasoning itself is now bounded separately (see
      // callGroqJSON's reasoning_effort default). Narrow queries request
      // less (see requestedMaxTokens above) since they don't need it.
      {
        model: ANALYZE_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: requestedMaxTokens,
        reasoning_effort: adaptiveReasoningEffort,
      },
      "ai/analyze",
      // A short honest sentence ("I can't read that PDF — paste the figures
      // and I'll work through them") is a legitimate answer to some
      // questions, and JSON mode rejects it as a schema violation. Without
      // this, that exact answer became a 400 and the founder saw a generic
      // failure instead of the reply the model had already written. See
      // salvageProse in groq.ts.
      { salvageProseAs: "summary" },
    );

    // ---- Backstop: never badge the model's own safety refusal as analysis ----
    //
    // needsCrisisResponse above is the real control and catches this on the
    // way in. This catches it on the way OUT, for the phrasings that control
    // misses — because the observed failure was not only that the reply was
    // cold, it was that "I'm really sorry you're feeling like this, but I
    // can't help with that" was rendered with an EXPLORATORY badge reading
    // "Grounded in a live web search plus general reasoning". A refusal is not
    // a researched finding, and dressing one as the other is the product
    // asserting rigour it did not apply.
    //
    // Returns before the confidence block below rather than deleting fields
    // after it, so there is no ordering left to get wrong later. The summary
    // is the model's own words — deliberately not rewritten here, since this
    // branch exists for cases the crisis detector did not recognise and
    // substituting a crisis script for an unknown refusal would be guessing.
    if (parsed && typeof parsed.summary === "string" && looksLikeModelSafetyRefusal(parsed.summary)) {
      req.log.warn({ userId: sessionId }, "Model returned a safety refusal — stripping confidence badge");
      logMessage({ userId: sessionId, chatId: body.data.chatId, role: "user", content: body.data.message }).catch(() => {});
      logMessage({ userId: sessionId, chatId: body.data.chatId, role: "assistant", content: parsed.summary }).catch(() => {});
      return res.json({ summary: parsed.summary, cards: [] });
    }

    if (parsed) {
      // Confidence is computed from the actual evidence assembled for this
      // response (precedent match quality/verification/contradiction, plus
      // this founder's own resolved-decision track record) instead of a
      // blind lookup on retrieval.tier — see confidence.ts for the formula.
      const confidenceResult = computeConfidence(retrieval, ownDecisions);
      parsed.confidenceTier = retrieval.tier;
      parsed.confidence = confidenceResult.tier;
      parsed.confidenceScore = confidenceResult.score;
      parsed.confidenceFactors = confidenceResult.factors;
      parsed.evidenceRefs = confidenceResult.evidenceRefs;
      parsed.groundedIn = confidenceResult.groundedIn;
      if (confidenceResult.contradictions.length > 0) {
        parsed.contradictions = confidenceResult.contradictions;
      }
      const contradictionNote = confidenceResult.contradictions.length > 0
        ? " Precedents disagree on outcome for this pattern — treat as a split signal, not consensus."
        : "";
      parsed.confidenceNote = confidenceResult.groundedIn === "own_history"
        ? "Grounded in your own resolved decisions in this area — no dataset precedent needed for this one." + contradictionNote
        : (retrieval.tier === "none"
            ? (webResult && !webResult.empty
                ? "Grounded in a live web search plus general reasoning — no direct match in the curated dataset for this specific question."
                : "Grounded in general strategic reasoning — no direct match in the curated dataset for this specific question.")
            : retrieval.tier === "moderate"
              ? "Grounded in a small or adjacent set of precedents — a slightly thinner evidence base than a direct match."
              : "Grounded in verified precedent coverage.") + contradictionNote;
      applyTierLabel(parsed, retrieval);

      // Shadow mode for fact-level contradiction detection (e.g. "churn is
      // up but so is NPS" stated in the same conversation): extractedFacts
      // is only present when the EXTRACTED_FACTS_INSTRUCTION was appended
      // (non-narrow queries — see systemPrompt assembly above). Detected
      // conflicts are logged for later review, never merged into the
      // visible response — see factConflicts.ts for why this stays
      // log-only until real production data confirms it's signal, not
      // noise, and confirms the actual marginal token cost.
      if (Array.isArray(parsed.extractedFacts)) {
        const extractedFactsRaw = JSON.stringify(parsed.extractedFacts);
        const factConflicts = detectFactConflicts(parsed.extractedFacts as ExtractedFact[]);
        for (const conflict of factConflicts) {
          console.error(`[factConflict] session=${sessionId} rule=${conflict.ruleId} facts=${JSON.stringify(conflict.facts)} query="${body.data.message.slice(0, 200)}"`);
        }
        console.error(`[factConflict] extractedFacts token delta ~${estimateTokens(extractedFactsRaw)} tokens (session=${sessionId})`);
        delete parsed.extractedFacts;
      }

      // Shadow mode for the evidence-convergence pipeline: evidenceConvergence
      // is only present when EVIDENCE_CONVERGENCE_INSTRUCTION was appended
      // (non-narrow queries — see systemPrompt assembly above). Computed and
      // logged for the upcoming manual calibration review (~15-20 known test
      // queries, per the plan this implements), never merged into the visible
      // response and never promoted until that review confirms both the real
      // token cost and that the convergence gate isn't collapsing into
      // permanent non-answers or converging too early.
      if (parsed.evidenceConvergence) {
        // Everything in this block reads raw LLM JSON that's only
        // shape-checked at the TypeScript-cast level (no runtime schema
        // enforcement — see evidenceConvergence.ts's file header). Wrapped
        // in try/catch/finally as a second, final layer of defense on top
        // of that file's own internal hardening: a shadow-mode calibration
        // feature must NEVER be able to turn an already-successful,
        // already-parsed founder response into buildTransientErrorResponse
        // just because the model returned an unexpected shape for a field
        // nobody but this log line reads. The `finally` guarantees
        // evidenceConvergence is stripped from the response even if
        // computation throws partway through.
        try {
          const hypotheses = Array.isArray(parsed.evidenceConvergence.hypotheses)
            ? (parsed.evidenceConvergence.hypotheses as Hypothesis[])
            : [];
          const evidenceContradictions = (parsed.evidenceConvergence.contradictions ?? "none_identified") as Contradiction[] | "none_identified";
          const convergence = computeConvergence(hypotheses, evidenceContradictions, retrieval.precedents, retrieval.tier);

          const leading = hypotheses.find((h) => h && h.id === convergence.leading_hypothesis_id) ?? null;
          const withheld = !(convergence.converged && leading);
          // Computed (Stage 6 gate) but not shipped — exercising the full
          // gate logic in shadow mode, including the template function, is
          // what makes promotion later a one-line diff (stop deleting
          // evidenceConvergence) instead of a rewrite.
          const outcomePreview = (!withheld && leading ? generateRecommendationText(leading) : withheldReasonFor(convergence.tier)).slice(0, 160);
          // Calibration-drift signal: how far the model's own self-reported
          // precedent_match_count/outcome_consistency diverge from what its
          // citations actually support once verified in code — see
          // evidenceConvergence.ts's file header for why these two fields
          // specifically needed a code-side cross-check.
          const drift = hypotheses
            .filter((h): h is Hypothesis => !!h && typeof h.id === "string")
            .map((h) => ({
              id: h.id,
              llmMatchCount: h.precedent_match_count,
              codeMatchCount: convergence.codeVerifiedMatchCounts[h.id],
              llmConsistency: h.outcome_consistency,
              codeConsistency: convergence.codeVerifiedOutcomeConsistency[h.id],
            }));
          const rawConvergenceJson = JSON.stringify(parsed.evidenceConvergence);
          // One consolidated line (not three) — easier to correlate per
          // request when interleaved with other requests' log output, and
          // fewer blocking synchronous stderr writes on the response path.
          console.error(`[convergence] ${JSON.stringify({
            sessionId, tier: convergence.tier, converged: convergence.converged,
            gap: convergence.convergence_gap, scores: convergence.scores, withheld,
            outcomePreview, drift, tokenDelta: estimateTokens(rawConvergenceJson),
          })}`);
        } catch (convergenceErr) {
          console.error("[convergence] shadow-mode computation failed, continuing without it", convergenceErr);
        } finally {
          delete parsed.evidenceConvergence;
        }
      }

      let sanitized = sanitizeVenusResponse(parsed);

      // Mechanically enforce any stored literal style preference (no
      // em-dashes, no emoji) rather than trusting the model followed its own
      // confirmation — found live: a response that just promised "no
      // em-dashes going forward" used one in that same sentence. Cheap, pure
      // string ops, so it runs unconditionally rather than being gated by
      // query scope.
      if (typeof sanitized.summary === "string" && preferenceFacts.length > 0) {
        sanitized.summary = enforceStylePreferences(sanitized.summary, preferenceFacts.map((f) => f.factText));
      }

      // Item 7: quantifiable constraint verification. Models can't reliably
      // count characters/words from tokens, so a stated length constraint
      // ("exactly 50 words") is self-reported and unreliable if left to the
      // model alone. This is a LIVE, blocking check (unlike the shadow-mode
      // arithmetic/groundedness checks below) — bounded retries actually
      // revise the draft against the real, code-counted number until it
      // genuinely satisfies the constraint, per the explicit ask for this
      // item. Only ever runs when the founder's own message stated a
      // constraint (see lengthConstraint.ts) — never fires on an ordinary
      // request with no stated count.
      const lengthConstraint = parseLengthConstraint(body.data.message);
      if (lengthConstraint && typeof sanitized.summary === "string") {
        const MAX_LENGTH_REVISION_ATTEMPTS = 3;
        let attempt = 1;
        let check = verifyLengthConstraint(sanitized.summary, lengthConstraint);

        // IMPORTANT: each retry starts fresh from the ORIGINAL `messages`
        // array (system prompt + history + the founder's message) plus ONE
        // small extra instruction — it deliberately does NOT accumulate the
        // prior JSON.stringify(sanitized) response onto the message list.
        // Echoing the full previous response back in was the actual cause
        // of a real production hang found during testing: re-injecting a
        // whole card-laden JSON object on top of an already-tight ~7000-
        // token system prompt (see the 413-storm this file's own comments
        // document) triggered createWithRetry's shrink-and-backoff loop on
        // EVERY retry attempt, compounding latency into minutes instead of
        // seconds. The target count alone is all the model needs — it
        // doesn't need its own prior draft replayed to revise it.
        while (!check.ok && attempt < MAX_LENGTH_REVISION_ATTEMPTS) {
          attempt++;
          const revisionMessages = [
            ...messages,
            {
              role: "user" as const,
              content: `Your draft's "summary" field is actually ${check.actual} ${lengthConstraint.unit} (counted exactly, in code) — I asked for ${describeLengthConstraint(lengthConstraint)}. Return the same full JSON shape again, with the summary rewritten to genuinely hit that target.`,
            },
          ];
          const revision = await callGroqJSON(
            groq,
            { model: ANALYZE_MODEL, messages: revisionMessages, temperature: 0.4, max_tokens: requestedMaxTokens },
            `ai/analyze (length-constraint revision ${attempt})`,
          );
          if (!revision.parsed) break; // couldn't get a usable revision — ship the best attempt so far, flagged below
          sanitized = sanitizeVenusResponse(revision.parsed);
          check = typeof sanitized.summary === "string" ? verifyLengthConstraint(sanitized.summary, lengthConstraint) : check;
        }

        if (!check.ok) {
          // Bounded retries exhausted — ship the closest attempt, but never
          // silently claim compliance: an honest note beats a false one.
          console.error(`[lengthConstraint] session=${sessionId} could not converge after ${attempt} attempt(s): requested ${describeLengthConstraint(lengthConstraint)}, actual=${check.actual}`);
          sanitized.lengthConstraintNote = `Requested ${describeLengthConstraint(lengthConstraint)} — actual count is ${check.actual} ${lengthConstraint.unit}.`;
        }
      }

      // Response-integrity checks — run on every response (pure regex/math,
      // zero token cost, no reason to gate by query scope). Wrapped in
      // try/catch for the same reason as the shadow-mode blocks above: a
      // new post-processing check must never be able to turn an already
      // -good response into an error.
      try {
        const responseStrings = collectResponseStrings(sanitized);

        // Arithmetic-consistency: ships live — pure math, no real false-
        // positive risk once two same-currency, different-period mentions
        // are correctly paired (see arithmeticCheck.ts). Catches the
        // reported case directly: a monthly figure and a mislabeled
        // "quarterly" one that's actually the ×12 annual figure.
        const arithmeticIssues = responseStrings.flatMap(checkArithmeticConsistency);
        if (arithmeticIssues.length > 0) {
          sanitized.arithmeticIssues = arithmeticIssues;
        }

        // Currency- and entity-groundedness: PROMOTED off shadow mode — was
        // logged only (see groundedness.ts's original comment), never
        // reaching the founder, so a caught fabrication changed nothing
        // about what they saw. Still never blocks or rejects a response —
        // that risk (a false positive silently discarding a good answer) is
        // exactly why this stayed shadow-mode as long as it did — but a
        // heuristic catching a real fabrication and then saying nothing is
        // the worse failure for a product whose whole pitch is trust: the
        // founder finds out it was wrong later, with no warning it should
        // have double-checked. Surfaced the same non-blocking way
        // arithmeticIssues already proved out below: attached to the
        // response, rendered under "Check before you rely on this," never
        // silently swallowing a good answer. historyContext (the duplicated
        // conversation blob) no longer exists — the same turns are read
        // straight off effectiveSessionHistory here, which is if anything a
        // more complete grounding source since it isn't capped at the 8
        // turns that blob rendered. webSearchBlock is included too: a
        // currency or entity that appears in live search results is
        // genuinely grounded, and omitting it would flag correctly-sourced
        // figures.
        const historyGroundingText = (effectiveSessionHistory ?? [])
          .map((h: { content?: string }) => h.content ?? "")
          .join(" ");
        const groundingText = [
          effectiveBusinessContext, historyGroundingText, webSearchBlock, precedentBlock,
          ownHistoryBlock, openSessionBlock, goalBlock, memoryBlock,
          // Without this, correctly recalling a real detail from another chat
          // — the contact address the founder was given last week — reads to
          // the groundedness check as an entity that appeared from nowhere,
          // and the founder is warned to verify something Vera actually knows.
          crossChatBlock,
          body.data.message,
        ].filter(Boolean).join(" ");
        const groundednessIssues: { description: string }[] = [];

        const ungroundedCurrencies = detectUngroundedCurrency(responseStrings, groundingText);
        if (ungroundedCurrencies.length > 0) {
          console.error(`[groundedness] session=${sessionId} ungroundedCurrencies=${JSON.stringify(ungroundedCurrencies)} query="${body.data.message.slice(0, 200)}"`);
          for (const currency of ungroundedCurrencies) {
            groundednessIssues.push({
              description: `Uses ${currency} — that currency doesn't appear anywhere in what you told Vera or what it found. Worth double-checking.`,
            });
          }
        }

        // Ungrounded third-party entity claims: named outside company (e.g.
        // "YouTube") paired with a hard figure that appears nowhere in
        // anything actually supplied to the model (see groundedness.ts for
        // why the currency and arithmetic checks both miss this by
        // construction).
        const ungroundedEntityClaims = detectUngroundedEntityClaims(responseStrings, groundingText);
        if (ungroundedEntityClaims.length > 0) {
          console.error(`[groundedness] session=${sessionId} ungroundedEntityClaims=${JSON.stringify(ungroundedEntityClaims)} query="${body.data.message.slice(0, 200)}"`);
          for (const claim of ungroundedEntityClaims) {
            groundednessIssues.push({
              description: `Mentions "${claim.entity}" alongside a specific figure, but neither was part of what you told Vera or what it found — worth verifying before you rely on it.`,
            });
          }
        }

        if (groundednessIssues.length > 0) {
          sanitized.groundednessIssues = groundednessIssues;
        }
      } catch (integrityErr) {
        console.error("[responseIntegrity] check failed, continuing without it", integrityErr);
      }

      // Fire-and-forget: don't make the founder wait on this, and never let
      // a logging failure affect the response they actually asked for.
      autoLogDecisionCards(sessionId, body.data.message, effectiveBusinessContext, sanitized.cards, body.data.chatId).catch(() => {});
      // Completes the RAW LOG for this turn (see logMessage call for the
      // user's message above) — the readable summary a founder saw, plus a
      // compact digest of the cards. The digest is the fix for Vera being
      // unable to recall its own structured output one turn later; see
      // digestCardsForLog for why summary alone was not enough.
      if (typeof sanitized.summary === "string") {
        const cardDigest = digestCardsForLog(sanitized.cards);
        logMessage({
          userId: sessionId,
          chatId: body.data.chatId,
          role: "assistant",
          content: cardDigest ? `${sanitized.summary}\n\n[Cards shown with this answer: ${cardDigest}]` : sanitized.summary,
        })
          // Chained rather than fired in parallel: the summariser reads the
          // raw log, so starting it before this turn is written would fold in
          // everything except the exchange that just happened — leaving the
          // newest turn, the one a founder is most likely to ask about next,
          // out of memory until some later turn happened to sweep it up.
          .then(() => ensureChatSummary(sessionId, body.data.chatId))
          .catch(() => {});
      }
      return res.json(sanitized);
    }

    // A parse failure (model didn't return usable JSON even after the repair
    // retry in callGroqJSON) is just another case of "nothing usable came
    // back" — it gets the same short, plain, honest fallback as any other
    // exhausted-retries case, not its own diagnostic card.
    //
    // REMOVED: buildShortQueryFallback, which used to run first here. It
    // returned a decision card containing a single option literally named
    // "Primary path" with hardcoded scores — viability 6, speed 7,
    // defensibility 6, capital_efficiency 6 — none of which came from
    // anything. The UI renders those identically to real scored analysis, so
    // a founder whose request had just FAILED was shown fabricated numbers
    // presented as Vera's judgment. Every other guard in this codebase
    // exists to stop the model inventing figures; this one had us doing it
    // in code. There is no version of "the response failed" that should
    // produce scores, so the fallback is gone rather than softened.
    return res.json(buildTransientErrorResponse(body.data.message));
  } catch (err: any) {
    req.log.error(err);
    const { kind, retryAfterMs } = classifyGroqError(err);
    return res.json(buildTransientErrorResponse(body.data.message, kind, retryAfterMs));
  }
});

const ReportOutcomeBody = z.object({
  outcome: z.string().min(1),
  sentiment: z.enum(["positive", "negative", "mixed"]).optional(),
});

// Lists the founder's own decisions Venus has logged, most recent first —
// "open" ones are still waiting on an outcome, "resolved" ones already have
// one and are feeding retrieval. This is what lets the UI show a founder a
// running list of "here's what Venus told you and what's still unresolved,"
// which is also the natural place to prompt them to report back.
router.get("/ai/decisions", requireAuth, async (req, res) => {
  try {
    const sessionId = requireUserId(req);

    // Best-effort maintenance sweep on read, not a cron job — see
    // decisionMemory.ts. Never blocks or fails the actual list response.
    archiveStaleOpenDecisions(sessionId).catch(() => {});

    const conditions = [eq(venusDecisionsTable.sessionId, sessionId)];
    if (typeof req.query.status === "string") {
      conditions.push(eq(venusDecisionsTable.status, req.query.status));
    }
    if (typeof req.query.decisionType === "string") {
      conditions.push(eq(venusDecisionsTable.decisionType, req.query.decisionType));
    }
    // Archived rows are excluded by default (the common "browse my active
    // memory" case) — pass ?includeArchived=true to see everything.
    if (req.query.includeArchived !== "true") {
      conditions.push(eq(venusDecisionsTable.archived, false));
    }

    const rows = await db
      .select()
      .from(venusDecisionsTable)
      .where(and(...conditions))
      .orderBy(desc(venusDecisionsTable.createdAt))
      .limit(50);
    return res.json({ decisions: rows });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load decision history" });
  }
});

// Soft-hide noise (an accidental re-ask, a test query) from default browse
// views without discarding it as causal history — see venus_decisions'
// `archived` column comment. Idempotent: archiving an already-archived row
// is a no-op success, not an error.
router.patch("/ai/decisions/:id/archive", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid decision id" });

  try {
    const sessionId = requireUserId(req);
    const [updated] = await db
      .update(venusDecisionsTable)
      .set({ archived: true })
      .where(and(eq(venusDecisionsTable.id, id), eq(venusDecisionsTable.sessionId, sessionId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Decision not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to archive decision" });
  }
});

// The one human-in-the-loop step that can't be automated: the founder tells
// Venus what actually happened after acting (or not acting) on a past
// recommendation. This is what turns a logged-but-unresolved card into real
// ground truth that future retrieval can cite (see retrieveOwnResolvedDecisions).
// Venus derives a short causal "lesson" from the reported outcome using the
// same JSON-calling infrastructure as the main analyze route, so the lesson
// is immediately usable in future prompts without extra parsing at query time.
router.post("/ai/decisions/:id/outcome", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid decision id" });

  const body = ReportOutcomeBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body — 'outcome' (string) is required" });

  try {
    const sessionId = requireUserId(req);
    const [existing] = await db
      .select()
      .from(venusDecisionsTable)
      .where(and(eq(venusDecisionsTable.id, id), eq(venusDecisionsTable.sessionId, sessionId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Decision not found" });

    let lesson: string | null = null;
    const groq = getGroqClient();
    if (groq) {
      const { parsed } = await callGroqJSON(
        groq,
        {
          model: ANALYZE_MODEL,
          messages: [
            {
              role: "system",
              content: `You distill a single short, causal, one-sentence lesson from a resolved founder decision. Return ONLY a JSON object: { "lesson": "one sentence, causal, specific — not generic advice" }. The lesson must state what happened and why, in a form directly reusable to inform a similar future decision for the SAME founder. Never invent facts not present in what you're given.`,
            },
            {
              role: "user",
              content: `Original question: "${existing.query}"\nWhat Venus recommended: "${existing.recommendationSummary}"\nWhat actually happened (founder's own words): "${body.data.outcome}"`,
            },
          ],
          temperature: 0.3,
          max_tokens: 300,
        },
        "ai/decisions/outcome-lesson",
      );
      if (parsed && typeof parsed.lesson === "string" && parsed.lesson.trim()) {
        lesson = parsed.lesson.trim();
      }
    }

    // Missing/unconfigured Groq key, or the lesson call failed, shouldn't
    // block recording the outcome itself — the raw outcome text is still
    // genuine ground truth and gets used in retrieval even without a
    // distilled lesson (formatOwnDecisionsForPrompt handles a null lesson).
    await db
      .update(venusDecisionsTable)
      .set({
        outcome: body.data.outcome,
        lesson,
        outcomeSentiment: body.data.sentiment ?? null,
        status: "resolved",
        resolvedAt: new Date(),
      })
      .where(eq(venusDecisionsTable.id, id));

    // This is the actual mechanism behind the Origin──◉──Target marker
    // moving: only fires when the resolved card belongs to a chat that has
    // an ACTIVE goal, and only ever reads/writes that goal's evidenceScore —
    // never a task-count or completion percentage. A card with no chatId
    // (pre-Goal-feature rows, or ordinary ungoaled chats) simply doesn't
    // move anything, which is the correct behavior, not a bug to patch.
    if (existing.chatId) {
      try {
        const [goal] = await db
          .select()
          .from(goalsTable)
          .where(and(eq(goalsTable.chatId, existing.chatId), eq(goalsTable.status, "active")))
          .limit(1);
        if (goal) {
          const newScore = applyResolvedEvidence(goal.evidenceScore, body.data.sentiment ?? null);
          const logLine = `[${new Date().toISOString().slice(0, 10)}] ${body.data.sentiment ?? "unclear"}: ${existing.recommendationSummary} — ${body.data.outcome}`.slice(0, 500);
          await db
            .update(goalsTable)
            .set({
              evidenceScore: newScore,
              evidenceLog: goal.evidenceLog ? `${goal.evidenceLog}\n${logLine}` : logLine,
              updatedAt: new Date(),
            })
            .where(eq(goalsTable.id, goal.id));
        }
      } catch (evidenceErr) {
        // Same principle as autoLogDecisionCards: never let the evidence-
        // score side effect break the outcome the founder is waiting on.
        console.error("[ai/decisions/outcome] failed to update goal evidence score", evidenceErr);
      }
    }

    return res.json({ id, status: "resolved", lesson });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to record outcome" });
  }
});

router.post("/ai/company-report", requireAuth, async (req, res) => {
  try {
    const { companyName, context } = req.body as { companyName?: string; context?: string };
    if (!companyName) return res.status(400).json({ error: "companyName is required" });

    const sessionId = requireUserId(req);
    const groq = getGroqClient();

    if (!groq) {
      return res.json({
        companyName,
        snapshot: {
          foundedYear: "Unknown",
          founders: [],
          fundingRaised: "Unknown",
          whatTheyBuilt: "Report generation requires a configured Groq API key.",
        },
        timeline: [],
        analysis: "The report could not be generated because the Groq API key is not configured.",
        sources: [],
        generatedAt: new Date().toISOString(),
      });
    }

    // Was a second, hand-rolled copy of the DuckDuckGo scrape — carrying the
    // SAME broken result-link regex (`/uddg="([^"]+)"/g`) that never matched
    // real DDG markup. So this route silently found zero sources on every
    // request and generated "company research reports" from an empty
    // `articleSnippets` array — i.e. from nothing but the model's own
    // recall, while the prompt below told it those snippets were "the only
    // source material". Exactly the fabrication bug fixed in websearch.ts,
    // in a second place, unfixed because the logic had been duplicated.
    //
    // Now uses the shared helper, so there is one implementation to keep
    // correct instead of two that drift. A larger budget than the default is
    // requested because this route's prompt is small (no VENUS_PROMPT), so it
    // can afford real source text.
    const searchQuery = `${companyName} company overview funding founders timeline`;
    const companySearch = await webSearch(searchQuery, { maxSources: 5, totalCharBudget: 20000 });
    const articleSnippets = companySearch.sources.map((s) => s.snippet);

    // An empty search must be stated as empty. Handing the model a prompt that
    // calls the snippets "the only source material" and then supplying none is
    // an instruction to invent — which is precisely what this route did on
    // every request while its scraper was silently broken.
    const sourceMaterial = articleSnippets.length > 0
      ? `Search excerpts:\n${articleSnippets.join("\n\n").slice(0, 20000)}`
      : `Search excerpts: NONE — the live search returned no usable sources for this company. You therefore have no source material. Set every snapshot field to "Unknown", return an empty timeline and an empty sources array, and make "analysis" a single plain sentence saying no verifiable information could be retrieved for this company. Do NOT fill any field from your own recall.`;

    const prompt = `You are researching the company "${companyName}" for a founder-facing brief. Use the search snippets below as the only source material. If the evidence is weak or contradictory, mark unknown values rather than inventing facts. Return ONLY valid JSON with this shape: {"companyName":"string","snapshot":{"foundedYear":"string","founders":["string"],"fundingRaised":"string","whatTheyBuilt":"string"},"timeline":[{"label":"string","detail":"string"}],"analysis":"2-4 sentences","sources":[{"title":"string","url":"string"}]}. Do not mention that you are an AI. Do not include markdown. Context: ${context ?? ""}

${sourceMaterial}`;

    const { parsed } = await callGroqJSON(
      groq,
      {
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: "You synthesize factual company reports from web excerpts. Return strict JSON only and do not invent facts." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 3000,
      },
      "ai/company-report",
    );

    const report = parsed && typeof parsed === "object"
      ? {
          companyName,
          snapshot: {
            foundedYear: parsed.snapshot?.foundedYear ?? "Unknown",
            founders: Array.isArray(parsed.snapshot?.founders) ? parsed.snapshot.founders : [],
            fundingRaised: parsed.snapshot?.fundingRaised ?? "Unknown",
            whatTheyBuilt: parsed.snapshot?.whatTheyBuilt ?? "Unknown",
          },
          timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
          analysis: parsed.analysis ?? "No additional detail was available from the lookup sources.",
          sources: Array.isArray(parsed.sources) ? parsed.sources : companySearch.sources.map((s) => ({ title: s.url, url: s.url })),
          generatedAt: new Date().toISOString(),
        }
      : {
          companyName,
          snapshot: { foundedYear: "Unknown", founders: [], fundingRaised: "Unknown", whatTheyBuilt: "Unknown" },
          timeline: [],
          analysis: "The lookup did not return a structured report.",
          sources: companySearch.sources.map((s) => ({ title: s.url, url: s.url })),
          generatedAt: new Date().toISOString(),
        };

    return res.json(report);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to generate company report" });
  }
});

export default router;