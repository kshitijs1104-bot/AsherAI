import type Groq from "groq-sdk";
import { callGroqJSON } from "./groq";

// Replaces FACTUAL_EXTERNAL_QUERY (the keyword regex in ai.ts that decided
// whether a question deserved a live web search). That regex could only ever
// recognize phrasings someone had thought to enumerate — "reviews of",
// "compare to", "latest news on" — so a plain "give me a list of real schools
// in Mumbai" was classified as a strategy question, never searched, and
// answered from the model's imagination. Extending the regex with more
// phrasings would fail the same way on the next unseen wording; the vocabulary
// of real user questions is unbounded, so the classification has to generalize
// rather than enumerate.
//
// Runs on gpt-oss-20b, which has its own TPM pool separate from the
// gpt-oss-120b pool the main answer call spends — so this costs latency, not
// answer-quality headroom, on the free tier where that headroom is the binding
// constraint.
//
// DELIBERATELY returns two independent axes. They are not correlated: "what's
// the capital of France" is factual+simple, "what were our Q3 numbers" is
// factual+simple, "is this term sheet fair" is consultation+complex, and
// "which of these 3 vendors should we pick" is mixed+complex (needs real
// lookup AND real judgment).

export type QueryKind = "factual_lookup" | "consultation" | "mixed";
export type QueryComplexity = "simple" | "moderate" | "complex";

// Coarse failure families, not specific bugs — a rate per class is what
// generalizes across arbitrary future queries. See response_feedback schema.
export type IssueClass = "fabricated_entity" | "misread_intent" | "wrong_topic" | "other";

export interface QueryClassification {
  kind: QueryKind;
  complexity: QueryComplexity;
  // True when the honest answer depends on specific real-world facts
  // (names, figures, dates, current state) that the model cannot verify from
  // its own weights. Drives the grounding requirement in ai.ts.
  needsExternalFacts: boolean;
  // Whether this message is the founder telling Vera its PREVIOUS answer was
  // wrong. Detected here rather than by a regex because real corrections
  // don't follow a fixed shape — "these are false too" and "no such ones
  // exist" both reject the prior answer while matching none of the
  // rejection-word patterns preferenceDetection.ts looks for.
  //
  // Rides along on the classification call that already runs for every
  // message, so catching corrections costs no extra round-trip.
  correctsPriorAnswer: boolean;
  // Short description of what was wrong, and its failure family — only
  // meaningful when correctsPriorAnswer is true.
  detectedIssue: string | null;
  issueClass: IssueClass | null;
  // True when classification did not actually succeed and these values are
  // just defaults. Callers MUST treat this as "unknown", not as a real
  // "consultation / no external facts needed" answer.
  //
  // Without this flag the fallback was fail-CLOSED in the worst possible
  // direction: a failed classifier returned needsExternalFacts:false, which
  // made isFactualExternal false, which suppressed the web search — silently
  // restoring the exact fabrication behavior this whole change set exists to
  // prevent, and doing it precisely when the system was already degraded.
  // Grounding must fail OPEN: if we don't know whether a question needs real
  // sources, search anyway. The cost of an unnecessary search is latency; the
  // cost of a skipped one is an invented answer.
  failed: boolean;
}

// Used when classification is unavailable. Never blocks a response — a failed
// classification degrades, it doesn't error. `failed: true` is the important
// field: it tells callers these are placeholders, so grounding decisions fail
// OPEN (search anyway) rather than silently reverting to "no search needed".
export const DEFAULT_CLASSIFICATION: QueryClassification = {
  kind: "consultation",
  complexity: "moderate",
  needsExternalFacts: false,
  correctsPriorAnswer: false,
  detectedIssue: null,
  issueClass: null,
  failed: true,
};

const CLASSIFIER_SYSTEM_PROMPT = `Classify a founder's message to a business-advisor AI on two INDEPENDENT axes. Return ONLY JSON.

"kind":
- "factual_lookup" — answering it correctly requires specific real-world facts the assistant would have to look up (names of real places/people/organizations, current prices, addresses, dates, statistics, what some product does today). The user wants information, not judgment.
- "consultation" — answering it requires reasoning, judgment, or advice about the user's own situation (should I do X, why is Y happening, how do I approach Z). The user wants thinking, not lookup.
- "mixed" — genuinely needs both real external facts AND judgment on top of them.

"complexity":
- "simple" — a direct answer, definition, or single fact. One step.
- "moderate" — needs some reasoning or a couple of linked considerations.
- "complex" — multi-step causal reasoning, weighing trade-offs, diagnosing a cause, assessing risk, or a judgment call with real consequences.

"needsExternalFacts": true if a correct answer must state specific real-world facts (proper nouns, figures, dates, current state) that could be wrong if guessed. False if the answer is reasoning, opinion, or about the user's own stated situation.

"correctsPriorAnswer": true if the user is saying the assistant's PREVIOUS answer was wrong, false, made-up, or not what they asked for. Judge meaning, not phrasing — "these are false too", "no such ones exist", "that's not what I asked", "i dint ask for that" are ALL corrections even though they are worded completely differently. A follow-up question, a request to go deeper, or a new topic is NOT a correction. If there is no previous answer shown, this is always false.

"detectedIssue": when correctsPriorAnswer is true, one short phrase naming what was actually wrong (e.g. "listed schools that do not exist", "answered about skills labs when asked about schools"). Otherwise null.

"issueClass": when correctsPriorAnswer is true, exactly one of:
- "fabricated_entity" — invented names, places, organizations, statistics, or other specifics that aren't real
- "misread_intent" — answered a different question than the one asked (misread a word, an abbreviation, or the request)
- "wrong_topic" — drifted to an unrelated subject, or acted on an earlier turn instead of the current one
- "other" — a real correction that fits none of the above
Otherwise null.

Judge only what the message actually asks. Do not assume a business/startup topic — the user may ask about anything at all.

Return exactly: {"kind":"...","complexity":"...","needsExternalFacts":true|false,"correctsPriorAnswer":true|false,"detectedIssue":"..."|null,"issueClass":"..."|null}`;

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Never throws and never blocks: any failure returns DEFAULT_CLASSIFICATION,
 * which reproduces the pre-existing behavior rather than degrading it.
 */
export async function classifyQuery(
  groq: Groq,
  message: string,
  priorAssistantMessage?: string,
): Promise<QueryClassification> {
  try {
    // The prior answer is truncated hard: correction detection only needs
    // enough of it to tell what was being rejected, and this call's whole
    // value proposition is that it stays cheap.
    const priorBlock = priorAssistantMessage?.trim()
      ? `Assistant's previous answer:\n"""${priorAssistantMessage.slice(0, 600)}"""\n\n`
      : "";
    const { parsed } = await callGroqJSON(
      groq,
      {
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
          { role: "user", content: `${priorBlock}User's message to classify:\n"""${message.slice(0, 1000)}"""` },
        ],
        temperature: 0,
        max_tokens: 250,
        reasoning_effort: "low",
        include_reasoning: false,
      },
      "queryClassifier",
    );
    if (!parsed) return DEFAULT_CLASSIFICATION;

    const correctsPriorAnswer =
      Boolean(priorBlock) && typeof parsed.correctsPriorAnswer === "boolean" ? parsed.correctsPriorAnswer : false;

    return {
      kind: coerce(parsed.kind, ["factual_lookup", "consultation", "mixed"] as const, DEFAULT_CLASSIFICATION.kind),
      complexity: coerce(
        parsed.complexity,
        ["simple", "moderate", "complex"] as const,
        DEFAULT_CLASSIFICATION.complexity,
      ),
      needsExternalFacts:
        typeof parsed.needsExternalFacts === "boolean"
          ? parsed.needsExternalFacts
          : DEFAULT_CLASSIFICATION.needsExternalFacts,
      correctsPriorAnswer,
      // Only ever populated alongside a real correction — a stray
      // detectedIssue on a normal question would pollute the eval corpus
      // with non-failures.
      detectedIssue:
        correctsPriorAnswer && typeof parsed.detectedIssue === "string" && parsed.detectedIssue.trim()
          ? parsed.detectedIssue.trim().slice(0, 300)
          : null,
      issueClass: correctsPriorAnswer
        ? coerce(parsed.issueClass, ["fabricated_entity", "misread_intent", "wrong_topic", "other"] as const, "other")
        : null,
      failed: false,
    };
  } catch (err) {
    console.error("[queryClassifier] classification failed, falling back to consultation/moderate", err);
    return DEFAULT_CLASSIFICATION;
  }
}
