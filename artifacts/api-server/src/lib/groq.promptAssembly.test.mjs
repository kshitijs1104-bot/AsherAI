import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads the SOURCE rather than importing groq.ts, for the same reason
// groq.prompt.test.mjs does: that module opens a DB connection at import
// time, which a unit test has no business needing.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'groq.ts'), 'utf8');

const VALID_TAGS = new Set([
  'core', 'strategy', 'cards', 'drafting', 'capability', 'openEnded', 'ownHistory', 'openSession', 'crossChat',
]);

function parseSections() {
  const block = source.match(/const VENUS_PROMPT_SECTIONS[\s\S]*?\n\];/);
  assert.ok(block, 'VENUS_PROMPT_SECTIONS array not found — was the prompt restructured?');
  const re = /\{ tag: "([a-zA-Z]+)", text: `([\s\S]*?)` \},/g;
  const out = [];
  let m;
  while ((m = re.exec(block[0])) !== null) out.push({ tag: m[1], text: m[2].replace(/\r/g, '') });
  return out;
}

// Mirrors buildVenusPrompt() in groq.ts. Kept in sync deliberately: if the
// real assembly changes shape, these assertions should be re-read, not
// silently satisfied by importing the thing they're meant to be checking.
function build(
  sections,
  { mode = 'strategy', includeDrafting = false, hasOwnHistory = false, hasOpenSession = false, hasCrossChat = false } = {},
) {
  const w = new Set(['core']);
  if (mode === 'strategy') w.add('strategy');
  if (mode === 'drafting' || includeDrafting) w.add('drafting');
  if (mode === 'capability') w.add('capability');
  if (mode === 'open_ended') w.add('openEnded');
  if (mode !== 'drafting') w.add('cards');
  if (hasOwnHistory) w.add('ownHistory');
  if (hasOpenSession) w.add('openSession');
  if (hasCrossChat) w.add('crossChat');
  return sections.filter((s) => w.has(s.tag)).map((s) => s.text).join('\n\n');
}

const estimateTokens = (t) => Math.ceil(t.length / 4);
// The hard ceiling: tpmLimitForModel("openai/gpt-oss-120b") on the free tier.
// Exceeding this is the actual API rejection.
const FREE_TIER_TPM = 8000;
// The self-imposed target, TPM_SAFETY_MARGIN below the ceiling — the headroom
// that absorbs token-estimate error and leaves room for grounding material.
const FREE_TIER_BUDGET = Math.floor(FREE_TIER_TPM * 0.85);
const MIN_USABLE_MAX_TOKENS = 1200;

test('every prompt section carries a known tag', () => {
  const sections = parseSections();
  assert.ok(sections.length > 40, `expected the full prompt to parse, got ${sections.length} sections`);
  for (const s of sections) {
    assert.ok(VALID_TAGS.has(s.tag), `unknown tag "${s.tag}" — buildVenusPrompt would silently drop this section`);
    assert.ok(s.text.trim().length > 0, 'empty section');
  }
});

test('the cross-chat rule rides on every mode a recall question can land in', () => {
  const sections = parseSections();
  // A founder asking "what did we talk about last time" is classified
  // open_ended or capability far more often than strategy, so gating this rule
  // on mode would drop it from exactly the messages it exists to answer. The
  // rule is what stops Vera denying a conversation whose record is in the
  // prompt — the live failure this whole path was built for.
  for (const mode of ['strategy', 'drafting', 'capability', 'open_ended']) {
    const withMemory = build(sections, { mode, hasCrossChat: true });
    assert.match(withMemory, /OTHER CONVERSATIONS WITH THIS FOUNDER/, `${mode} lost the cross-chat rule`);
    assert.match(withMemory, /NEVER say you have no record/, `${mode} lost the denial guard`);

    // And it is not carried when the block itself isn't in the prompt — a rule
    // for reading a block that isn't there is pure budget.
    const without = build(sections, { mode });
    assert.doesNotMatch(without, /OTHER CONVERSATIONS WITH THIS FOUNDER/, `${mode} carries the rule with no block`);
  }
});

test('every assembled mode is a valid, self-sufficient prompt', () => {
  const sections = parseSections();
  const endMarker = sections[sections.length - 1].text;

  for (const mode of ['strategy', 'drafting', 'capability', 'open_ended']) {
    const prompt = build(sections, { mode });
    // Groq's json_object response mode hard-rejects a request whose messages
    // never contain the word "json" — a mode that dropped it would 400 on
    // every call.
    assert.match(prompt, /json/i, `${mode} prompt lost the "json" keyword`);
    // shrinkMessages locates the instruction/context boundary with this — a
    // mode missing it would have its dynamic context wrongly protected from
    // shrinking, re-sending an oversized payload on every 413 retry.
    assert.ok(prompt.includes(endMarker), `${mode} prompt lost the end marker`);
    assert.match(prompt, /"summary"/, `${mode} prompt lost the response shape`);
  }
});

test('the strategy path keeps the entire causal-reasoning stack', () => {
  const prompt = build(parseSections(), { mode: 'strategy' });
  // The load-bearing reasoning rules. This is the guard against the whole
  // point of the restructure being quietly undone by a re-tagged section:
  // strategy answers are the ones that must never degrade.
  for (const anchor of [
    /CONTEXT SUFFICIENCY GATE/,
    /EVIDENCE-FIRST REASONING/,
    /GENUINELY DIFFERENT HYPOTHESES/,
    /CAUSAL CHAIN/,
    /DON'T SKIP THE BEHAVIOR LINK/,
    /FIX MUST MATCH THE DIAGNOSED BOTTLENECK/,
    /SPECIFICITY OVER TEMPLATES/,
    /NO FAKE PRECISION/,
    /DON'T DEFAULT TO SAFE/,
    /CONFIDENCE NOTE GROUNDING/,
    /CHECK YOURSELF BEFORE RETURNING/,
    /RETRIEVAL-GATED PRECEDENTS/,
    // Card schemas — a strategy answer returns cards, so it needs their shapes.
    /For roadmap cards the content is/,
    /For decision cards the content is/,
  ]) {
    assert.match(prompt, anchor, `strategy prompt is missing ${anchor}`);
  }
});

test('fabrication guards ride on every mode, not just strategy', () => {
  const sections = parseSections();
  for (const mode of ['strategy', 'drafting', 'capability', 'open_ended']) {
    const prompt = build(sections, { mode });
    // These are the trust rules. A mode that can emit prose can invent a
    // number or a company name, so none of them may ever be mode-gated.
    assert.match(prompt, /NO FAKE PRECISION/, `${mode} lost NO FAKE PRECISION`);
    assert.match(prompt, /RETRIEVAL-GATED PRECEDENTS/, `${mode} lost the precedent gate`);
  }
});

test('drafting mode carries its craft rules and sheds the reasoning stack', () => {
  const prompt = build(parseSections(), { mode: 'drafting' });
  assert.match(prompt, /DRAFTING MODE/);
  assert.match(prompt, /DRAFTING CRAFT/);
  // The savings that make the whole thing worth doing. Anchored on text
  // unique to the sections themselves — "CONTEXT SUFFICIENCY GATE" appears
  // inside DRAFTING MODE's own body ("also exempt from...") and so is not
  // evidence the gate section itself was included.
  assert.doesNotMatch(prompt, /\(A\) ENOUGH TO ANSWER/);
  assert.doesNotMatch(prompt, /GENUINELY DIFFERENT HYPOTHESES/);
});

test('a drafting request routed as strategy still gets its drafting rules', () => {
  // ai.ts ORs a keyword check in alongside the classification precisely so a
  // misclassified draft request doesn't get a full LinkedIn post capped at
  // "3-5 plain sentences". This is that safety net.
  const prompt = build(parseSections(), { mode: 'strategy', includeDrafting: true });
  assert.match(prompt, /DRAFTING MODE/);
  assert.match(prompt, /EVIDENCE-FIRST REASONING/);
});

test('block-conditional rules appear only when their block does', () => {
  const sections = parseSections();
  const without = build(sections, { mode: 'strategy' });
  assert.doesNotMatch(without, /YOUR OWN VERIFIED HISTORY OUTRANKS EVERYTHING/);
  assert.doesNotMatch(without, /SAME-SESSION RECOMMENDATION CONSISTENCY/);

  const withBlocks = build(sections, { mode: 'strategy', hasOwnHistory: true, hasOpenSession: true });
  assert.match(withBlocks, /YOUR OWN VERIFIED HISTORY OUTRANKS EVERYTHING/);
  assert.match(withBlocks, /SAME-SESSION RECOMMENDATION CONSISTENCY/);
});

test('even the worst-case assembly fits the free-tier ceiling with output', () => {
  const sections = parseSections();
  // THE REGRESSION THIS WHOLE RESTRUCTURE EXISTS TO FIX. The prompt was
  // ~7,022 tokens and, at the 1,200-token output floor, every request came
  // to ~8,222 against a hard 8,000 ceiling — over the limit before a single
  // token of business context, precedent or memory was added. That is the
  // "TPM limit hit / can't respond" failure, and it was unconditional.
  //
  // Asserted against the hard ceiling rather than the 85% budget on purpose:
  // clampMaxTokensToTpmBudget deliberately lets max_tokens exceed the budget
  // rather than fall under MIN_USABLE_MAX_TOKENS (truncated JSON is worse
  // than a thin margin), so the budget is a target and this is the real wall.
  for (const mode of ['strategy', 'drafting', 'capability', 'open_ended']) {
    const worstCase = build(sections, { mode, hasOwnHistory: true, hasOpenSession: true, includeDrafting: true });
    const tokens = estimateTokens(worstCase);
    assert.ok(
      tokens + MIN_USABLE_MAX_TOKENS <= FREE_TIER_TPM,
      `${mode} worst case is ~${tokens} tokens; with the ${MIN_USABLE_MAX_TOKENS}-token output floor that breaches the ${FREE_TIER_TPM} free-tier ceiling before any context is added`,
    );
  }
});

test('the common strategy request leaves real room for grounding material', () => {
  // The worst case above only has to not fail. The COMMON case — a strategy
  // question from a founder with no resolved-decision history yet — has to
  // leave enough headroom that business context, the dossier and precedents
  // survive rather than being shrunk away, since silently dropping those is
  // how a "remembers everything" advisor starts forgetting things.
  const tokens = estimateTokens(build(parseSections(), { mode: 'strategy' }));
  const headroom = FREE_TIER_BUDGET - tokens - MIN_USABLE_MAX_TOKENS;
  assert.ok(
    headroom > -400,
    `the plain strategy prompt (~${tokens} tokens) leaves ${headroom} tokens under the ${FREE_TIER_BUDGET} budget after the output floor — grounding material would be shrunk away on most requests`,
  );
});
