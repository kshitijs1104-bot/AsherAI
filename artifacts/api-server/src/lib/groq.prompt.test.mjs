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
