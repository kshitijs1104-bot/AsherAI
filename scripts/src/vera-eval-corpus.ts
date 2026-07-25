// F7, part 1 of 2: the CORPUS GENERATOR.
//
// WHY THIS IS GENERATED AND NOT A FILE OF HAND-WRITTEN CASES: the same reason
// the disambiguation fix refuses to ship a dictionary of ambiguous terms. A
// hand-maintained list of test queries only ever covers the failures somebody
// already thought of, and trails real usage exactly as badly as a term list
// would. The bug that started this work ("skls" read as "skill lab", invented
// Mumbai schools) would not have appeared on any list written before it
// happened.
//
// So the corpus is produced along DIMENSIONS instead of enumerated: vary the
// domain, the entity type, the locale, the abbreviation style, the query
// intent — and generate across the cross-product. That catches failures in the
// general mechanism rather than in specific remembered instances.
//
// Two sources, deliberately combined:
//   1. SYNTHETIC — generated here across the dimension grid. Broad coverage,
//      but they are guesses about how Vera might fail.
//   2. REAL — every founder correction captured by response_feedback (see
//      lib/responseFeedback.ts). These are recorded facts about how it DID
//      fail, and they arrive at the rate the product is actually used.
// Real cases outrank synthetic ones whenever both exist for a behavior.

// Deliberately calls Groq over plain fetch rather than importing groq-sdk:
// keeps this script runnable with nothing installed beyond what the workspace
// already has, so an eval never fails to run because of a dependency graph.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type EvalTier = "simple_factual" | "multi_step" | "judgment";

export interface EvalCase {
  id: string;
  query: string;
  tier: EvalTier;
  // What a correct response must do. Deliberately behavioral, not an exact
  // expected string — there is no single right wording for advice.
  expectation: {
    // Must the answer be grounded in a real retrieved source before it may
    // state specific names/figures?
    requiresGrounding: boolean;
    // Is refusing-to-specify (admitting no verified data) an acceptable pass?
    // True for factual asks Vera genuinely cannot source.
    mayDeclineSpecifics: boolean;
    // Must the answer commit to a recommendation rather than list options?
    requiresVerdict: boolean;
  };
  // Provenance, so a regression report can say whether a failure was on a
  // real observed bug or a synthetic probe.
  source: "synthetic" | "production_correction";
  // Only set for production cases — lets the failure-class metric be computed
  // per class rather than as one undifferentiated pass rate.
  issueClass?: string;
}

// The dimension grid. Adding a dimension value here expands coverage
// multiplicatively without anyone writing a new test case by hand — that is
// the entire point. Deliberately NOT startup-specific: Vera is domain-general,
// and the reported failure was a question about schools, not about startups.
export const DIMENSIONS = {
  domain: [
    "education", "healthcare", "food and restaurants", "real estate", "travel",
    "local services", "retail", "software", "finance", "fitness", "legal", "agriculture",
  ],
  entityType: [
    "institutions by name", "people by name", "products by name", "places/addresses",
    "prices", "statistics", "dates and events", "regulations",
  ],
  locale: [
    "Mumbai India", "Bangalore India", "London UK", "Singapore", "Lagos Nigeria",
    "São Paulo Brazil", "rural Texas USA", "Berlin Germany",
  ],
  abbreviationStyle: [
    "fully spelled out", "common abbreviations (govt, dept)", "sms-style contractions (skls, msg, plz)",
    "typos and transposed letters", "mixed-language shorthand",
  ],
  intent: [
    "asking for a list of real things", "asking whether a specific claim is true",
    "asking for a recommendation between options", "asking why something is happening",
    "asking how to do something", "asking for a definition",
  ],
} as const;

const GENERATOR_PROMPT = `You generate test queries for evaluating an AI advisor's reasoning and factual grounding.

Produce realistic queries a real user would actually type — including sloppy ones. Do NOT make them all well-formed: real users use abbreviations, typos, and fragments.

For each query also decide:
- "tier": "simple_factual" (one lookup or definition), "multi_step" (needs several linked steps of reasoning), or "judgment" (a real decision or risk call with trade-offs).
- "requiresGrounding": true if answering correctly REQUIRES specific real-world facts (real names, real figures, real addresses) that must not be guessed.
- "mayDeclineSpecifics": true if it would be a perfectly good answer to say "I don't have verified data on that" instead of listing specifics.
- "requiresVerdict": true if the user is asking for a decision and a non-committal "it depends" would be a failure.

Return ONLY JSON: {"cases":[{"query":"...","tier":"...","requiresGrounding":true|false,"mayDeclineSpecifics":true|false,"requiresVerdict":true|false}]}`;

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Seeded RNG so a corpus is reproducible when a seed is supplied — a
// regression run needs to compare like with like, but the DEFAULT is a fresh
// random corpus each time, because a corpus frozen forever becomes just
// another hand-curated list that usage outgrows.
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface GenerateOptions {
  count: number;
  seed?: number;
  batchSize?: number;
}

export async function generateSyntheticCorpus(
  apiKey: string,
  opts: GenerateOptions,
): Promise<EvalCase[]> {
  const rng = makeRng(opts.seed ?? Date.now());
  const batchSize = opts.batchSize ?? 10;
  const cases: EvalCase[] = [];

  while (cases.length < opts.count) {
    // Each batch samples a fresh point on the dimension grid, so the corpus
    // spreads across the space instead of clustering wherever the model's
    // defaults sit.
    const combos = Array.from({ length: batchSize }, () => ({
      domain: pick(DIMENSIONS.domain, rng),
      entityType: pick(DIMENSIONS.entityType, rng),
      locale: pick(DIMENSIONS.locale, rng),
      abbreviationStyle: pick(DIMENSIONS.abbreviationStyle, rng),
      intent: pick(DIMENSIONS.intent, rng),
    }));

    const spec = combos
      .map(
        (c, i) =>
          `${i + 1}. domain=${c.domain}; about=${c.entityType}; location=${c.locale}; writing style=${c.abbreviationStyle}; intent=${c.intent}`,
      )
      .join("\n");

    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: GENERATOR_PROMPT },
            { role: "user", content: `Generate exactly one query for each spec below.\n\n${spec}` },
          ],
          temperature: 1.0, // high on purpose: diversity is the goal here, not consistency
          max_tokens: 2000,
          response_format: { type: "json_object" },
        }),
      });
      const completion = (await response.json()) as any;
      const raw = completion?.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      for (const c of parsed.cases ?? []) {
        if (typeof c?.query !== "string" || !c.query.trim()) continue;
        cases.push({
          id: `syn-${cases.length + 1}`,
          query: c.query.trim(),
          tier: ["simple_factual", "multi_step", "judgment"].includes(c.tier) ? c.tier : "multi_step",
          expectation: {
            requiresGrounding: Boolean(c.requiresGrounding),
            mayDeclineSpecifics: Boolean(c.mayDeclineSpecifics),
            requiresVerdict: Boolean(c.requiresVerdict),
          },
          source: "synthetic",
        });
        if (cases.length >= opts.count) break;
      }
    } catch (err) {
      console.error("[vera-eval-corpus] batch generation failed, continuing", err);
      break; // don't spin forever against a failing API
    }
  }

  return cases;
}

/**
 * Turns captured production corrections into eval cases. These are the
 * highest-value cases in the corpus: each one is a failure that actually
 * happened to a real person, with the exact input that caused it.
 */
export function corpusFromCorrections(
  rows: { id: number; originalQuery: string | null; issueClass: string | null }[],
): EvalCase[] {
  return rows
    .filter((r) => r.originalQuery && r.originalQuery.trim())
    .map((r) => ({
      id: `prod-${r.id}`,
      query: r.originalQuery as string,
      // A correction means the previous answer was wrong; replaying the
      // original query is the regression test. Grounding is required by
      // definition for the fabrication class.
      tier: (r.issueClass === "fabricated_entity" ? "simple_factual" : "multi_step") as EvalTier,
      expectation: {
        requiresGrounding: r.issueClass === "fabricated_entity",
        mayDeclineSpecifics: r.issueClass === "fabricated_entity",
        requiresVerdict: false,
      },
      source: "production_correction" as const,
      issueClass: r.issueClass ?? "other",
    }));
}
