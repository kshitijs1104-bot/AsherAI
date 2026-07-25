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

export interface QueryClassification {
  kind: QueryKind;
  complexity: QueryComplexity;
  // True when the honest answer depends on specific real-world facts
  // (names, figures, dates, current state) that the model cannot verify from
  // its own weights. Drives the grounding requirement in ai.ts.
  needsExternalFacts: boolean;
}

// Preserves today's behavior exactly when the classifier is unavailable:
// treat it as a normal strategy question of ordinary depth. Never blocks a
// response — a failed classification must degrade, not error.
export const DEFAULT_CLASSIFICATION: QueryClassification = {
  kind: "consultation",
  complexity: "moderate",
  needsExternalFacts: false,
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

Judge only what the message actually asks. Do not assume a business/startup topic — the user may ask about anything at all.

Return exactly: {"kind":"...","complexity":"...","needsExternalFacts":true|false}`;

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Never throws and never blocks: any failure returns DEFAULT_CLASSIFICATION,
 * which reproduces the pre-existing behavior rather than degrading it.
 */
export async function classifyQuery(groq: Groq, message: string): Promise<QueryClassification> {
  try {
    const { parsed } = await callGroqJSON(
      groq,
      {
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
          { role: "user", content: message.slice(0, 1000) },
        ],
        temperature: 0,
        max_tokens: 150,
        reasoning_effort: "low",
        include_reasoning: false,
      },
      "queryClassifier",
    );
    if (!parsed) return DEFAULT_CLASSIFICATION;

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
    };
  } catch (err) {
    console.error("[queryClassifier] classification failed, falling back to consultation/moderate", err);
    return DEFAULT_CLASSIFICATION;
  }
}
