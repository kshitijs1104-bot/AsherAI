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
  assert.match(source, /ONE PRIORITIZED FIRST MOVE, NEVER A PARALLEL BUNDLE/i);
  // Actions beyond the first survive only as consequences of it, so depth is
  // preserved as a single thread rather than flattened into parallel items.
  assert.match(source, /sequential consequence or contingency only, never a parallel item/i);
  // The counter-guard, and the reason this rule can't be stated as "give one
  // action": collapsing to a bare imperative ("map the pipeline.") trades a
  // checklist for something even less useful. The chain, the behavior link
  // and the 30-60 day metric all still apply.
  assert.match(source, /Not license to go bare/i);
});

test('a hold/wait verdict names the condition that would reverse it', () => {
  // A "not yet" without a trigger is advice with a hidden expiry date: the
  // founder has no way to know when it stops being true, so the only way to
  // re-evaluate is to ask again from scratch. Naming the reversal condition
  // turns a point-in-time verdict into a decision rule they can hold onto.
  assert.match(source, /the condition that reverses it/i);
  assert.match(source, /hidden expiry date/i);
});
