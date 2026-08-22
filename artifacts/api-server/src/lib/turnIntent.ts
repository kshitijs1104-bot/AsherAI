import type { IssueClass } from "./queryClassifier";

// ---- Turn intent: is this message a REPLY, or a standalone statement? ----
//
// WHY THIS EXISTS. Every pre-model gate in ai.ts (isPureContextStatement,
// requiresContext/buildContextClarification) was written to answer the
// question "what is in this message?" — does it contain business vocabulary,
// does it contain a question word, does it end in "?". None of them ever
// asked "what is this message DOING in this conversation?"
//
// That distinction is the whole bug. The same words mean different things
// depending on what came before them. "not testing budget giving 25% as
// dscount is unreasonable" contains a percentage (business-metric shaped),
// contains no "?", and contains no interrogative word — so by content alone
// it looks exactly like a founder dumping business context with nothing to
// answer, and it was routed to a bare "Got it — noted: ..." acknowledgment.
// Read as a TURN, it is unmistakably the founder telling Vera it misread the
// previous answer. Confirmed live, three times in one conversation.
//
// Every previous fix for this class of failure widened a keyword list (see
// the `questionish` regex in ai.ts and its four accumulated FIX comments —
// "shld", "whyd", "hows", the imperative-verb family). That approach cannot
// converge: the set of ways to phrase a correction without a question word
// is unbounded, so the next unlisted phrasing fails identically. This module
// changes the axis instead of extending the list.
//
// TWO LAYERS, cheapest first — the same philosophy as inferDecisionRouting /
// classifyQueryScope / preferenceDetection:
//   1. looksLikeReplyToPriorTurn (here) — structural, free, no round-trip. It
//      matches on conversational MOOD and DEIXIS (rejection openers,
//      second-person reference to Vera's own last turn, "i meant"), not on
//      topic vocabulary. This is a much smaller and more stable space than
//      "all the ways to phrase a question", because these markers are
//      grammatical rather than semantic.
//   2. classifyQuery's correctsPriorAnswer (queryClassifier.ts) — the model
//      judging meaning, which generalizes to phrasings nobody enumerated.
//      Already computed for every message; ai.ts now simply consults it
//      BEFORE the gates instead of after them.
//
// Layer 1 alone would be another keyword list. Layer 2 alone would be a
// network round-trip in front of the cheapest, most common path. Together,
// either one firing is enough to stop a reply from being swallowed, which is
// the direction the errors should fall: withholding an answer from someone
// mid-conversation is far more damaging than answering a message that could
// technically have been treated as a context dump.

// A reply that opens by rejecting, negating, or restating what was just
// said. Anchored to the START of the message on purpose — a "no" or "not" in
// the middle of a sentence is ordinary prose ("we're not profitable yet"),
// while one at the front is almost always aimed at the previous turn.
//
// Written against the RAW message, not normalizeQueryText's output, so
// informal contractions with the apostrophe dropped ("thats", "im", "u")
// work the same as the typed-out forms without needing rejoinContractions.
const REJECTION_OPENER =
  /^\s*(no+\b|nope\b|nah\b|not\b|wrong\b|incorrect\b|that'?s?\s+not\b|that\s+is\s+not\b|that'?s?\s+wrong\b|actually\b|but\b|i\s+meant\b|i\s+mean\b|i'?m\s+saying\b|im\s+saying\b|i\s+was\s+saying\b|i\s+said\b|i'?m\s+correcting\b|im\s+correcting\b|correcting\b|re-?read\b|read\s+(it|that)\s+again\b|listen\b)/i;

// A reply that talks ABOUT Vera's previous turn rather than introducing a
// topic: second-person reference to what Vera said/did, or a demonstrative
// pointing at the answer itself. Deixis like this cannot occur in a genuine
// standalone context dump — there is nothing for it to point at.
const ADDRESSES_PRIOR_TURN =
  /\b(u|you|ur|your|you'?re|youre)\s+(said|say|says|answered|answer|replied|mentioned|told|gave|keep|kept|misunderstood|misread|missed|didn'?t|dint|did\s+not|are\s+wrong|'?re\s+wrong)\b|\b(that|this|it|the)\s+(answer|response|reply|reading|interpretation)\b|\bnot\s+what\s+i\s+(asked|said|meant)\b|\bans(wer)?\s+(my|the)\s+(question|q)\b|\bthat'?s?\s+not\s+what\s+i\b|\byou'?re\s+missing\b|\bmisunderstood\b|\bmisread\b/i;

/**
 * True when this message reads as a response to Asher's own previous turn
 * rather than a self-contained statement.
 *
 * Deliberately STRUCTURAL, never topical: it looks at how the message is
 * addressed, not what it is about. That is what lets it generalize past the
 * specific wordings that have burned this codebase before, and what keeps it
 * from firing on a genuine first-message business description (which has no
 * prior turn to address and opens by describing, not rejecting).
 *
 * Returns false whenever there is no prior assistant turn — with nothing
 * said yet, no message can be a reply to it.
 */
export function looksLikeReplyToPriorTurn(message: string, priorAssistantMessage: string): boolean {
  if (!priorAssistantMessage || !priorAssistantMessage.trim()) return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  return REJECTION_OPENER.test(trimmed) || ADDRESSES_PRIOR_TURN.test(trimmed);
}

// Named so the log line reads as a routing decision, not a classification —
// this is why a message did or didn't get an answer.
//
// "fail_open" is the deliberate unknown case: the model classifier didn't
// succeed, so we genuinely do not know whether this message is a reply, and
// there IS a prior turn it could be replying to. Both possible errors are
// not equal. Answering a message that could have been treated as a context
// dump costs the founder one slightly-off answer they can redirect in a
// sentence. Withholding an answer from someone mid-conversation — the "Got
// it — noted" non-answer — is the failure that makes the product feel
// broken, and it arrives exactly when the system is already degraded. So an
// unknown resolves toward answering, matching the same fail-OPEN reasoning
// queryClassifier.ts already applies to whether a question needs grounding.
export type ReplyDetectionSource = "structural" | "model" | "fail_open" | "none";

/**
 * Instruction injected into the system prompt when the founder is telling
 * Vera its previous answer was wrong.
 *
 * WHY THIS IS NEEDED SEPARATELY FROM THE ROUTING FIX ABOVE: routing only
 * decides that the message reaches the model at all. Once there, nothing in
 * the prompt distinguished "founder asked a question" from "founder is
 * rejecting what you just said" — correctsPriorAnswer was computed, logged
 * to response_feedback for offline evals, and then dropped on the floor
 * before prompt assembly. So even the corrections that DID reach the model
 * came back as near-verbatim restatements of the rejected answer with an
 * agreeable opener ("Yes, allocating about 25% ... is the right call"),
 * which reads as not listening. Observed live on the message immediately
 * after "im correcting u".
 *
 * The instruction targets that specific failure mode: re-derive what was
 * actually asked before answering, and never re-affirm the rejected answer
 * without engaging the objection.
 */
export function buildCorrectionInstruction(detectedIssue: string | null, issueClass: IssueClass | null): string {
  const issueLine = detectedIssue
    ? `\nWhat they appear to be correcting: "${detectedIssue}"${issueClass ? ` (failure type: ${issueClass})` : ""}. Treat this as a strong hint, not gospel — the founder's own words in the current message are the authority.`
    : "";

  return `\n\nTHE FOUNDER IS CORRECTING YOU. This message is not a new question — it is the founder telling you your previous answer was wrong, misread what they asked, or answered something they didn't ask.${issueLine}

Handle it in this order:
1. Work out what they ACTUALLY meant, re-reading their earlier message in light of this correction. A correction usually means you resolved an ambiguous phrase the wrong way — find that phrase and flip your reading of it. (Example of the shape: the founder writes a bare percentage about a discount, you read it as a share of a testing budget, they say "no, I'm saying that discount is too much" — the number was never about the budget.)
2. If you did misread them, say so in one short clause and move straight on — "Right, you're asking about the discount, not the budget split" — then answer the question they actually asked. One clause. No apology paragraph, no restating the misunderstanding back to them at length.
3. If you did NOT misread them and your previous answer still stands, defend it with the specific reason it survives their objection. Disagreeing with a founder is allowed and expected. What is never allowed is repeating the previous recommendation with new wording as though the objection was never made.
4. Never respond to a correction with an acknowledgment ("Got it — noted"), a summary of what they just said, or a request to rephrase. They already told you what they meant; answer it now with the same directness and specificity as any other answer.

Do not open with "Yes" or any other agreement token unless you have first engaged with what they said was wrong.`;
}
