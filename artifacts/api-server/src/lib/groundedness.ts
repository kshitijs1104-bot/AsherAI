// Shadow-mode only (see ai.ts's [groundedness] logging) — narrow, cheap
// first pass at catching fabrication: reject/flag outputs referencing a
// currency absent from the actual input, which is exactly the reported
// case (₹-only business context, response fabricated "$2M"). Deliberately
// NOT general entity/figure verification (invented company names,
// unsourced numbers) — that needs NLP or a second LLM call, which would
// fight the token-budget work this session has already spent two commits
// on. Broader checking is a scoped follow-up once this narrow version is
// validated against real traffic, not part of this pass.
//
// Stays shadow-mode (logged, never attached to the response) because it's
// new and unvalidated — an auto-reject/flag on a false positive would
// itself become a new "good answer blocked" bug.

const CURRENCY_PATTERN = /[₹$€£¥]|\b(?:INR|USD|EUR|GBP|JPY)\b/gi;

function normalizeCurrency(raw: string): string {
  const c = raw.toUpperCase();
  if (c === "₹" || c === "INR") return "INR";
  if (c === "$" || c === "USD") return "USD";
  if (c === "€" || c === "EUR") return "EUR";
  if (c === "£" || c === "GBP") return "GBP";
  if (c === "¥" || c === "JPY") return "JPY";
  return c;
}

function extractCurrencyMarkers(text: string): Set<string> {
  const markers = new Set<string>();
  for (const match of text.matchAll(CURRENCY_PATTERN)) {
    markers.add(normalizeCurrency(match[0]));
  }
  return markers;
}

// responseStrings: every individual string field from the response (see
// responseText.ts's collectResponseStrings) — joined here since, unlike
// the arithmetic check, this doesn't need same-passage proximity: a
// fabricated currency is a problem wherever in the response it appears.
export function detectUngroundedCurrency(responseStrings: string[], groundingText: string): string[] {
  const responseCurrencies = extractCurrencyMarkers(responseStrings.join(" "));
  if (responseCurrencies.size === 0) return [];
  const groundingCurrencies = extractCurrencyMarkers(groundingText);
  return [...responseCurrencies].filter((c) => !groundingCurrencies.has(c));
}

/* ---- Ungrounded third-party factual claims ---- */
//
// The failure this catches, verbatim from a real session: a founder said
// "i own twitch ... i already pay them 2 bucks per 1000 views as ad rev",
// and Vera answered "Because you already keep only $2 per 1,000 views after
// YouTube takes its 55% cut ...". YouTube was never mentioned by the
// founder, has no relationship to Twitch's economics, and the 55% figure
// came from nowhere — a named outside company plus a hard number, invented
// and then reasoned from as established fact. The existing checks in this
// file and arithmeticCheck.ts both miss it by construction: the currency
// ($) WAS grounded, and the arithmetic ($2 - 55% ≈ $0.90) is internally
// self-consistent. What makes it a fabrication is the ENTITY, not the math.
//
// Deliberately narrow — the signal is specifically "a proper-noun entity
// that appears nowhere in anything we actually gave the model, stated in
// the same sentence as a hard figure". An unsupported qualitative mention
// ("platforms like YouTube do this differently") is not flagged; only a
// named entity carrying a specific number, which is the shape that gets
// reasoned from downstream as if verified.

// Sentence-initial capitals are not proper-noun evidence, and neither are
// these: ordinary words that legitimately appear capitalized mid-sentence
// (after a colon/dash, in a title-cased card label), plus the business,
// finance and time vocabulary that shows up constantly in this product's
// own output. Anything here is never treated as a third-party entity.
const NON_ENTITY_CAPITALS = new Set([
  // pronouns / determiners / conjunctions / common sentence openers
  "the", "this", "that", "these", "those", "your", "you", "their", "there", "then", "they", "our", "we", "it", "its",
  "if", "and", "but", "or", "so", "because", "since", "while", "when", "where", "what", "which", "who", "why", "how",
  "a", "an", "as", "at", "by", "for", "from", "in", "into", "of", "on", "to", "with", "without", "per", "each", "every",
  "no", "not", "now", "only", "also", "both", "either", "neither", "any", "all", "most", "more", "less", "least",
  "do", "does", "did", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "will", "would",
  "should", "could", "can", "may", "might", "must", "keep", "keeps", "stick", "add", "adding", "raise", "raising",
  "cut", "cuts", "pay", "pays", "paying", "give", "gives", "make", "makes", "take", "takes", "taking", "push", "put",
  "aim", "target", "assume", "assuming", "consider", "note", "instead", "however", "meanwhile", "overall", "still",
  // time
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "q1", "q2", "q3", "q4", "fy", "day", "days", "week", "weeks", "month", "months", "quarter", "year", "years", "today",
  // business / finance vocabulary and metric acronyms this product emits constantly
  "revenue", "profit", "margin", "margins", "growth", "churn", "retention", "runway", "burn", "cash", "cost", "costs",
  "price", "pricing", "budget", "spend", "customer", "customers", "creator", "creators", "user", "users", "team",
  "market", "product", "business", "company", "startup", "founder", "stage", "seed", "series", "round", "valuation",
  "equity", "investor", "investors", "funding", "raise", "bonus", "bonuses", "payout", "payouts", "subscription",
  "ads", "ad", "views", "view", "impressions", "clicks", "conversion", "metric", "metrics", "target", "goal", "goals",
  "mrr", "arr", "cac", "ltv", "cpm", "cpc", "roi", "nrr", "arpu", "gmv", "ebitda", "kpi", "kpis", "tam", "sam", "som",
  "b2b", "b2c", "d2c", "saas", "api", "ai", "ml", "vc", "vcs", "usd", "inr", "eur", "gbp", "jpy", "primary", "answer",
  "current", "net", "impact", "phase", "horizon", "risk", "risks", "option", "options", "decision", "recommendation",
]);

// A hard figure: a percentage, or a currency amount. Deliberately NOT any
// bare number — "5 creators", "3 pilot firms", "top 5 earners" are ordinary
// advice, not verifiable third-party claims.
const HARD_FIGURE = /\d+(?:\.\d+)?\s?%|[₹$€£¥]\s?\d|(?:\b(?:INR|USD|EUR|GBP|JPY)\s?\d)/i;

// Word-ish candidates, extracted by scanning rather than by splitting on
// whitespace: a fabricated entity is often glued to punctuation or a figure
// inside one whitespace-delimited token ("$0.55*YouTube share", "(YouTube)"),
// which whitespace splitting leaves starting with a non-letter and therefore
// misses entirely. Anchoring each match on a letter finds the entity itself
// wherever it sits inside the token.
const WORD_CANDIDATE = /[A-Za-z][A-Za-z0-9.'’&-]*/g;

// A proper-noun-shaped candidate: initial capital (YouTube, Stripe, Webvan)
// or an all-caps acronym of 2+ chars (AWS, IBM).
const CAPITALIZED_TOKEN = /^(?:[A-Z][A-Za-z0-9.'’&-]*[A-Za-z0-9]|[A-Z]{2,})$/;

export interface UngroundedEntityClaim {
  entity: string;
  sentence: string;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Normalized once for the whole check — an entity counts as grounded if it
// appears ANYWHERE in what we actually supplied (founder's message, stored
// business context, conversation history, retrieved precedents, live web
// search results, goal/memory blocks). Substring match, so "YouTube" is
// grounded by "youtube.com" and "Stripe" by "Stripe's".
function groundedLookup(groundingText: string): (entity: string) => boolean {
  const haystack = groundingText.toLowerCase();
  return (entity: string) => haystack.includes(entity.toLowerCase());
}

export function detectUngroundedEntityClaims(responseStrings: string[], groundingText: string): UngroundedEntityClaim[] {
  const isGrounded = groundedLookup(groundingText);
  const claims: UngroundedEntityClaim[] = [];
  const seen = new Set<string>();

  for (const raw of responseStrings) {
    if (typeof raw !== "string" || !HARD_FIGURE.test(raw)) continue;

    for (const sentence of splitSentences(raw)) {
      if (!HARD_FIGURE.test(sentence)) continue;

      const candidates = [...sentence.matchAll(WORD_CANDIDATE)].map((m) => m[0]);
      candidates.forEach((candidate, index) => {
        // Trim trailing sentence punctuation / possessives while keeping
        // internal ones (YouTube's -> YouTube, AT&T and Inc. intact).
        const cleaned = candidate.replace(/['’]s$/, "").replace(/[.'’&-]+$/, "");
        if (cleaned.length < 2) return;
        // The first word of a sentence is capitalized by grammar, so its
        // capitalization carries no proper-noun signal.
        if (index === 0) return;
        if (!CAPITALIZED_TOKEN.test(cleaned)) return;
        if (NON_ENTITY_CAPITALS.has(cleaned.toLowerCase())) return;
        if (isGrounded(cleaned)) return;

        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        claims.push({ entity: cleaned, sentence: sentence.length > 240 ? `${sentence.slice(0, 240)}…` : sentence });
      });
    }
  }

  return claims;
}
