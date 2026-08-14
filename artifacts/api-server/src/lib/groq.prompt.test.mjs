import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(__dirname, 'groq.ts');
const source = readFileSync(promptPath, 'utf8');

test('Venus prompt includes direct-verdict instructions for real decision forks and binary questions', () => {
  // Binary yes/no questions get an explicit up-front verdict, not hedging.
  assert.match(source, /Lead with an explicit verdict word/i);
  assert.match(source, /no "yes if\/no if" hedging/i);
  // Short/fragmentary phrasing is still treated as a real, direct question.
  assert.match(source, /short\/fragmentary queries[\s\S]*?complete strategic input/i);
  // A genuine multi-path comparison gets a plain-language call, not a
  // manufactured numeric split defaulting to some example ratio.
  assert.match(source, /default 60\/40/i);
  assert.match(source, /plain-language call/i);
  // A decision card is never forced onto a question that doesn't have a
  // genuine second viable path.
  assert.match(source, /Skip for single-path or pure information questions/i);
  // Options are weighed against each other by real signal (risk severity),
  // not scored arbitrarily.
  assert.match(source, /HIGH-severity risk against one option/i);
});

test('the recommendation is one prioritized first move, never an enumerated bundle', () => {
  // THE FAILURE THIS GUARDS. The summary rule already bans markdown lists
  // (no "#", no bullets, no bold), and a response can satisfy it completely
  // while still reading as a task list: "prioritize mapping the pipeline,
  // capping the longest stage, adding a validation call, and running a
  // sprint" contains no markup at all. That is a checklist with the bullets
  // deleted, and it turns a consultant's call into a backlog — the founder
  // has to work out for themselves which of the four to do first, which is
  // exactly the judgment they came for.
  assert.match(source, /ONE PRIORITIZED FIRST MOVE.{0,10}NEVER A PARALLEL BUNDLE/i);
  // Actions beyond the first survive only as consequences of it, so depth is
  // preserved as a single thread rather than flattened into parallel items.
  assert.match(source, /sequential consequence or contingency only, never parallel/i);
  // The counter-guard, and the reason this rule can't be stated as "give one
  // action": collapsing to a bare imperative ("map the pipeline.") trades a
  // checklist for something even less useful. The chain and metric still
  // apply — compression into one thread is the fix, not less depth.
  assert.match(source, /never bare \("map the pipeline\.?"\)/i);
});

test('a hold/wait verdict names the condition that would reverse it', () => {
  // A "not yet" without a trigger is advice with a hidden expiry date: the
  // founder has no way to know when it stops being true, so the only way to
  // re-evaluate is to ask again from scratch. Naming the reversal condition
  // turns a point-in-time verdict into a decision rule they can hold onto.
  assert.match(source, /the condition that reverses it/i);
  assert.match(source, /hidden expiry date/i);
});

test('a plan target either uses a real baseline or is explicitly marked an estimate', () => {
  // THE FAILURE THIS GUARDS: EVERY 30/60-DAY PLAN NEEDS NUMBERS demands a
  // concrete target, and without a counterweight the model invents one that
  // merely looks measured (a specific "≤35 days" or "≥20%" with no founder
  // baseline behind it) — precisely the "fake precision" NO FAKE PRECISION
  // already forbids for probabilities and market sizing, just not yet for
  // plan targets. This reuses that same discipline instead of inventing a
  // parallel one.
  assert.match(source, /Same NO FAKE PRECISION rule governs the number/i);
  assert.match(source, /relative framing/i);
  assert.match(source, /labeled estimate/i);
});

test('a tactical recommendation branches only on a fact the first move is meant to reveal', () => {
  // THE PRECISE TRIGGER, deliberately narrower than "something is unknown."
  // "We don't know the founder's team size" must NOT block a recommendation
  // (CONTEXT SUFFICIENCY GATE already guarantees that) — but "which sales
  // stage is actually causing the slowdown" SHOULD block a stage-specific
  // fix, because the plan's own first move (map the cycle by stage) is what
  // would answer that question. Branching has to track causal dependency on
  // the first move's outcome, not general uncertainty, or Vera regresses
  // into hedging every recommendation with an unresolved fact anywhere near
  // it — which CONTEXT SUFFICIENCY GATE and MAKE THE BET both already guard
  // against from the other direction.
  assert.match(source, /causally dependent on a fact the first move exists to reveal/i);
  assert.match(source, /branch on that fact/i);
  // The escape hatch: mere absence of a fact is not the trigger, and the
  // overall verdict is never itself hedged into a branch — only the
  // downstream tactical detail that logically depends on it is.
  assert.match(source, /mere absence of a fact doesn't trigger this/i);
  assert.match(source, /the overall call is never itself a branch/i);
});
