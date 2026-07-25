// F7, part 2 of 2: the EVAL RUNNER.
//
// Scores every response on BOTH axes together, because either number alone is
// misleading: a change that improves reasoning but doubles token cost is not a
// win on a tier where the prompt already exceeds the per-minute budget, and a
// change that cuts cost by making answers shallower is not a win at all. Every
// report below prints quality and tokens side by side for exactly that reason.
//
// The headline metric is a FAILURE-CLASS RATE, not a pass/fail tally against
// fixed cases. "Fabricated an entity on 12% of grounding-required queries" stays
// meaningful as usage moves into territory nobody anticipated; "18/20 known
// cases passed" stops meaning anything the moment real users ask something new.
//
// Usage:
//   GROQ_API_KEY=... pnpm --filter @workspace/scripts eval
//   GROQ_API_KEY=... pnpm --filter @workspace/scripts eval -- --count 60 --seed 7
//   ... --baseline baseline.json     compare against a previous run
//   ... --out baseline.json          save this run as the new baseline

import { readFileSync, writeFileSync } from "node:fs";
import { generateSyntheticCorpus, corpusFromCorrections, type EvalCase } from "./vera-eval-corpus.js";

const API_BASE = process.env.VERA_API_BASE ?? "http://localhost:3000";

interface CaseResult {
  id: string;
  query: string;
  tier: EvalCase["tier"];
  source: EvalCase["source"];
  issueClass?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  // Failure classes detected in the response. Empty array = clean.
  failures: string[];
  summary: string;
}

// ---- Automated failure detection ----
//
// These check STRUCTURAL properties that can be verified mechanically. They
// deliberately do NOT try to score "was the advice good" — that needs a human
// or a judge model, and a fake numeric quality score would be exactly the
// false precision Vera's own prompt forbids. What these DO catch is every
// failure class actually observed in production so far.

const HEDGE_PATTERN = /\b(it depends|there'?s no (single|one) (right )?answer|both (options|paths) (are|have)|hard to say)\b/i;

/** A specific-looking named entity or figure asserted in the response. */
function containsSpecificClaims(text: string): boolean {
  // Proper-noun-ish sequences (two capitalized words) or explicit figures.
  return /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(text) || /≈?\s?\d[\d,]{2,}\s*(students|pupils|users|customers|people)\b/i.test(text);
}

function detectFailures(c: EvalCase, response: any): string[] {
  const failures: string[] = [];
  const summary = typeof response?.summary === "string" ? response.summary : "";

  if (!summary.trim()) {
    failures.push("empty_response");
    return failures;
  }

  // Did the pipeline actually return usable structure?
  if (response?.cards === undefined) failures.push("malformed_schema");

  // FABRICATION: the case requires real grounding, the response asserts
  // specific entities/figures, but nothing was cited as a source and the
  // confidence badge doesn't claim verification. This is the exact shape of
  // the invented-schools bug.
  if (c.expectation.requiresGrounding && containsSpecificClaims(summary)) {
    const grounded =
      Array.isArray(response?.evidenceRefs) && response.evidenceRefs.length > 0
        ? true
        : /https?:\/\/|according to|per\s+\w|source/i.test(summary);
    if (!grounded) failures.push("fabricated_entity");
  }

  // MISSING VERDICT: a decision question answered with a hedge.
  if (c.expectation.requiresVerdict && HEDGE_PATTERN.test(summary)) {
    failures.push("no_verdict");
  }

  // OVERCLAIMED CONFIDENCE: "verified" badge on an answer with no evidence
  // behind it — the false-VERIFIED-badge bug.
  if (response?.confidence === "verified" && (!Array.isArray(response?.evidenceRefs) || response.evidenceRefs.length === 0)) {
    failures.push("overclaimed_confidence");
  }

  return failures;
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${API_BASE}/api/ai/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.VERA_EVAL_TOKEN ? { Authorization: `Bearer ${process.env.VERA_EVAL_TOKEN}` } : {}),
      },
      body: JSON.stringify({ message: c.query }),
    });
    const body = (await res.json()) as any;
    const summary = typeof body?.summary === "string" ? (body.summary as string) : "";
    // The route doesn't return usage, so tokens are estimated with the same
    // chars/4 heuristic the server budgets with (see groq.ts estimateTokens) —
    // consistent with the server's own accounting, which is what matters for
    // comparing runs against each other.
    const completionTokens = Math.ceil(JSON.stringify(body).length / 4);
    return {
      id: c.id,
      query: c.query,
      tier: c.tier,
      source: c.source,
      issueClass: c.issueClass,
      promptTokens: 0, // server-side only; read from [callGroqJSON] logs if needed
      completionTokens,
      totalTokens: completionTokens,
      latencyMs: Date.now() - started,
      failures: detectFailures(c, body),
      summary: summary.slice(0, 300),
    };
  } catch (err) {
    return {
      id: c.id,
      query: c.query,
      tier: c.tier,
      source: c.source,
      issueClass: c.issueClass,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - started,
      failures: ["request_failed"],
      summary: String(err).slice(0, 200),
    };
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

interface Report {
  generatedAt: string;
  caseCount: number;
  failureClassRates: Record<string, number>;
  byTier: Record<string, { count: number; failureRate: number; avgTokens: number; avgLatencyMs: number }>;
  avgTokens: number;
  results: CaseResult[];
}

function buildReport(results: CaseResult[]): Report {
  const total = results.length || 1;
  const classCounts = new Map<string, number>();
  for (const r of results) for (const f of r.failures) classCounts.set(f, (classCounts.get(f) ?? 0) + 1);

  const byTier: Report["byTier"] = {};
  for (const tier of ["simple_factual", "multi_step", "judgment"]) {
    const rows = results.filter((r) => r.tier === tier);
    if (rows.length === 0) continue;
    byTier[tier] = {
      count: rows.length,
      failureRate: +(rows.filter((r) => r.failures.length > 0).length / rows.length).toFixed(3),
      avgTokens: Math.round(rows.reduce((s, r) => s + r.totalTokens, 0) / rows.length),
      avgLatencyMs: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    failureClassRates: Object.fromEntries(
      [...classCounts.entries()].map(([k, v]) => [k, +(v / total).toFixed(3)]).sort((a, b) => (b[1] as number) - (a[1] as number)),
    ),
    byTier,
    avgTokens: Math.round(results.reduce((s, r) => s + r.totalTokens, 0) / total),
    results,
  };
}

function printReport(report: Report, baseline?: Report) {
  const delta = (now: number, before?: number) =>
    before === undefined ? "" : ` (${now - before >= 0 ? "+" : ""}${(now - before).toFixed(3)} vs baseline)`;

  console.log(`\n=== Vera eval — ${report.caseCount} cases — ${report.generatedAt} ===\n`);

  console.log("FAILURE-CLASS RATES (share of all cases exhibiting each class):");
  if (Object.keys(report.failureClassRates).length === 0) {
    console.log("  none detected");
  }
  for (const [cls, rate] of Object.entries(report.failureClassRates)) {
    console.log(`  ${cls.padEnd(24)} ${(rate * 100).toFixed(1)}%${delta(rate, baseline?.failureClassRates[cls])}`);
  }

  console.log("\nQUALITY AND COST BY TIER (never read one without the other):");
  console.log(`  ${"tier".padEnd(18)}${"n".padEnd(6)}${"failRate".padEnd(12)}${"avgTokens".padEnd(12)}avgLatency`);
  for (const [tier, s] of Object.entries(report.byTier)) {
    const b = baseline?.byTier[tier];
    console.log(
      `  ${tier.padEnd(18)}${String(s.count).padEnd(6)}${(s.failureRate * 100).toFixed(1).padEnd(12)}%${String(s.avgTokens).padEnd(11)}${s.avgLatencyMs}ms` +
        (b ? `   [was ${(b.failureRate * 100).toFixed(1)}% / ${b.avgTokens}tok]` : ""),
    );
  }

  console.log(`\nAVERAGE TOKENS/RESPONSE: ${report.avgTokens}${baseline ? ` (baseline ${baseline.avgTokens})` : ""}`);

  const prod = report.results.filter((r) => r.source === "production_correction");
  if (prod.length > 0) {
    const fixed = prod.filter((r) => r.failures.length === 0).length;
    console.log(`\nREGRESSION CASES FROM REAL CORRECTIONS: ${fixed}/${prod.length} now clean`);
  }

  console.log("\nWORST OFFENDERS:");
  for (const r of report.results.filter((x) => x.failures.length > 0).slice(0, 10)) {
    console.log(`  [${r.failures.join(",")}] ${r.query.slice(0, 70)}`);
  }
  console.log("");
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is required to generate the corpus.");
    process.exit(1);
  }
  const count = Number(arg("count", "40"));
  const seed = arg("seed") ? Number(arg("seed")) : undefined;

  console.error(`Generating ${count} synthetic cases across the dimension grid...`);
  const synthetic = await generateSyntheticCorpus(apiKey, { count, seed });

  // Fold in real production corrections when a DB is reachable. Optional on
  // purpose: the eval must be runnable by anyone with an API key, without
  // requiring database access.
  let production: EvalCase[] = [];
  try {
    const { getUnconsumedFeedback } = await import("@workspace/api-server/src/lib/responseFeedback.js" as string);
    production = corpusFromCorrections(await getUnconsumedFeedback(200));
    console.error(`Folded in ${production.length} real production corrections.`);
  } catch {
    console.error("No DB access — running on synthetic cases only.");
  }

  const corpus = [...production, ...synthetic];
  console.error(`Running ${corpus.length} cases against ${API_BASE}...`);

  const results: CaseResult[] = [];
  for (const c of corpus) {
    results.push(await runCase(c));
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  const report = buildReport(results);

  let baseline: Report | undefined;
  const baselinePath = arg("baseline");
  if (baselinePath) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch {
      console.error(`Could not read baseline at ${baselinePath} — reporting without comparison.`);
    }
  }

  printReport(report, baseline);

  const outPath = arg("out");
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.error(`Report written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
