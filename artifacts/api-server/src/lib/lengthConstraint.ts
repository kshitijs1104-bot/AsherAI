// Item 7: quantifiable constraint verification. Models can't reliably count
// characters/words from tokens — a stated "exactly 50 words" constraint is
// self-reported by the model today and is unreliable. This is the code-level
// ground truth check: parse a length constraint from the founder's OWN
// message (not the model's output), count the model's actual response in
// code, and — unlike the shadow-mode arithmeticCheck/groundedness checks —
// this one is live/blocking: ai.ts loops a bounded number of revision
// requests until the code-verified count actually satisfies the constraint,
// or gives up honestly after the bound.
//
// ROOT-CAUSE REWRITE. The original parser matched `<qualifier?> <n>
// <words|characters>` ANYWHERE in the message and defaulted a bare number to
// "exact". Because it runs on every response — not just drafts — that
// silently hijacked ordinary questions. Measured against the real parser
// before this rewrite:
//
//   "we only have 50 characters left in the product title field, what
//    should we do"        -> whole answer forced to EXACTLY 50 characters
//   "our top 3 words customers use are speed, price, trust"
//                         -> whole answer forced to EXACTLY 3 words
//   "why is my churn 8% and our tagline is 60 characters long"
//                         -> whole answer forced to EXACTLY 60 characters
//
// Each of those also burned up to 3 extra full LLM calls failing to converge,
// then shipped a mutilated answer. The bug is not the regex being too small —
// widening it would make this worse. The bug is that it read a NUMBER when it
// needed to read an INSTRUCTION. A length constraint is something the founder
// asks OF the answer; a number of words sitting in a sentence that describes
// their product is not one, however it's phrased.
//
// So the parse is now three judgments, in this order:
//   1. DESCRIPTIVE? ("our tagline IS 60 characters LONG", "we only HAVE 50
//      characters LEFT") — a copula/possession frame around the figure means
//      it's describing something in the founder's world. Reject outright.
//   2. DIRECTIVE? — an explicit qualifier ("under 280"), an instruction verb
//      aimed at the output ("keep it to", "draft", "summarise in"), or a
//      deliverable noun right after ("a 100-word post"). Without one of
//      these, there is no instruction here. Reject.
//   3. HOW STRICT? — only "exactly/precisely" means exact. Ceilings
//      ("under", "at most", "max") mean max. Everything else, INCLUDING a
//      bare "draft a 100 word post", means approximate: a founder asking for
//      a 100-word post wants roughly 100 words, and forcing a hard 100 makes
//      the model pad or amputate the draft to hit a number nobody cares
//      about, at 3x the cost.

export interface LengthConstraint {
  unit: "words" | "characters";
  operator: "exact" | "max" | "approx";
  count: number;
}

// Scanned globally (not `exec`'d once) so a descriptive figure early in the
// message can be rejected without hiding a real instruction later in it:
// "our tagline is 60 characters long — draft me a 30 word replacement".
const CANDIDATE_PATTERN = /(\d+)\s*-?\s*(words?|characters?|chars?)\b/gi;

// Immediately before the figure: the founder is stating a fact about
// something that already exists, not asking for an answer of that size.
const DESCRIPTIVE_BEFORE =
  /\b(is|was|are|were|be|been|being|has|have|had|only|just|contains?|counts?|counted|runs?|ran|came\s+(?:in|to)|sits?\s+at|stands?\s+at)\s+(?:only\s+|about\s+|roughly\s+|around\s+|some\s+)?$/i;

// Immediately after the unit: "60 characters LONG", "50 characters LEFT" —
// same descriptive frame, closing rather than opening.
const DESCRIPTIVE_AFTER = /^\s*(long|left|remaining|wide|deep|total|in\s+(length|total|it))\b/i;

// Adjacent qualifier — must sit directly against the figure to count, because
// these words ("in", "to", "of", "about") are far too common to match loosely.
const ADJACENT_QUALIFIER =
  /\b(exactly|precisely|under|below|within|max(?:imum)?|at\s+most|no\s+more\s+than|no\s+longer\s+than|not?\s+more\s+than|up\s+to|fewer\s+than|less\s+than|around|about|roughly|approx(?:imately)?|~|in|to|of)\s+$/i;

// An instruction aimed at the OUTPUT, allowed to sit a little further back
// ("keep your answer to 50 words", "summarise this in 30 words").
const DIRECTIVE_VERB =
  /\b(keep|make|write|draft|compose|rewrite|redo|give|send|reply|respond|answer|summar(?:y|ise|ize|ised|ized)|limit|cap|trim|shorten|condense|tighten|expand|restrict|hold|stick)\b/i;

// A deliverable named right after the figure — "a 100-word post", "a 280
// character tweet". The noun is what makes the number an instruction.
const DELIVERABLE_NOUN =
  /^\s*(post|caption|tweet|thread|summary|recap|reply|email|mail|script|answer|response|bio|headline|intro|blurb|description|pitch|message|note|version|draft|paragraph|copy|blurbs|snippet|tagline|hook)\b/i;

// How far back each signal may sit from the figure. The adjacent qualifier
// window is deliberately tiny; the verb window covers a normal clause.
const ADJACENT_WINDOW = 18;
const DIRECTIVE_WINDOW = 52;
const AFTER_WINDOW = 28;

function operatorFor(prefix: string): LengthConstraint["operator"] {
  if (/\b(exactly|precisely)\s+$/i.test(prefix)) return "exact";
  if (/\b(under|below|within|max(?:imum)?|at\s+most|no\s+more\s+than|no\s+longer\s+than|not?\s+more\s+than|up\s+to|fewer\s+than|less\s+than)\s+$/i.test(prefix)) {
    return "max";
  }
  // Includes the bare "draft a 100 word post" case — see the header comment
  // for why that is approximate rather than exact.
  return "approx";
}

export function parseLengthConstraint(userMessage: string): LengthConstraint | null {
  if (typeof userMessage !== "string" || !userMessage) return null;

  CANDIDATE_PATTERN.lastIndex = 0;
  for (const match of userMessage.matchAll(CANDIDATE_PATTERN)) {
    const index = match.index ?? 0;
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) continue;

    const before = userMessage.slice(0, index);
    const after = userMessage.slice(index + match[0].length, index + match[0].length + AFTER_WINDOW);

    // (1) Descriptive frames disqualify the figure entirely.
    if (DESCRIPTIVE_BEFORE.test(before.slice(-ADJACENT_WINDOW))) continue;
    if (DESCRIPTIVE_AFTER.test(after)) continue;

    // (2) Something must actually make this an instruction.
    const adjacentPrefix = before.slice(-ADJACENT_WINDOW);
    const directiveWindow = before.slice(-DIRECTIVE_WINDOW);
    const isDirective =
      ADJACENT_QUALIFIER.test(adjacentPrefix) ||
      DIRECTIVE_VERB.test(directiveWindow) ||
      DELIVERABLE_NOUN.test(after);
    if (!isDirective) continue;

    // (3) Strictness comes only from an explicit qualifier.
    const unit: LengthConstraint["unit"] = /char/i.test(match[2]) ? "characters" : "words";
    return { unit, operator: operatorFor(adjacentPrefix), count };
  }

  return null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface LengthCheckResult {
  ok: boolean;
  actual: number;
}

// ±10% for an approximate target, with a floor of 2 units so a small count
// ("about 20 words") doesn't collapse into an effectively-exact constraint
// that costs the same three revision round-trips this rewrite exists to stop.
const APPROX_TOLERANCE_RATIO = 0.1;
const APPROX_TOLERANCE_FLOOR = 2;

export function approxTolerance(count: number): number {
  return Math.max(APPROX_TOLERANCE_FLOOR, Math.round(count * APPROX_TOLERANCE_RATIO));
}

export function verifyLengthConstraint(text: string, constraint: LengthConstraint): LengthCheckResult {
  const actual = constraint.unit === "words" ? countWords(text) : text.length;
  const ok =
    constraint.operator === "exact"
      ? actual === constraint.count
      : constraint.operator === "max"
        ? actual <= constraint.count
        : Math.abs(actual - constraint.count) <= approxTolerance(constraint.count);
  return { ok, actual };
}

export function describeLengthConstraint(constraint: LengthConstraint): string {
  const noun = constraint.unit === "words" ? "words" : "characters";
  if (constraint.operator === "exact") return `exactly ${constraint.count} ${noun}`;
  if (constraint.operator === "max") return `at most ${constraint.count} ${noun}`;
  return `about ${constraint.count} ${noun} (within ${approxTolerance(constraint.count)})`;
}
