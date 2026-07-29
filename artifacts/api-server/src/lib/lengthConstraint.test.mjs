import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLengthConstraint, verifyLengthConstraint, describeLengthConstraint } from './lengthConstraint.ts';

// Run with:  npx tsx --test src/lib/lengthConstraint.test.mjs   (from artifacts/api-server)
//
// The three "must be null" cases in the first test are the measured
// false positives that hijacked ordinary strategy answers before the
// directive-aware rewrite — each forced the ENTIRE response to an absurd
// length and burned up to 3 extra LLM calls failing to converge.

test('descriptive figures never become constraints', () => {
  const notConstraints = [
    'we only have 50 characters left in the product title field, what should we do',
    'our top 3 words customers use are speed, price, trust',
    'why is my churn 8% and our tagline is 60 characters long',
    'the meta description is 155 characters and google truncates it',
    'competitors have 200 words of copy above the fold',
    'my bio has 120 characters right now',
  ];
  for (const message of notConstraints) {
    assert.equal(parseLengthConstraint(message), null, `should NOT be a constraint: "${message}"`);
  }
});

test('real instructions are still parsed, with the right strictness', () => {
  assert.deepEqual(parseLengthConstraint('keep it under 280 characters'), {
    unit: 'characters', operator: 'max', count: 280,
  });
  assert.deepEqual(parseLengthConstraint('summarise this in exactly 50 words'), {
    unit: 'words', operator: 'exact', count: 50,
  });
  assert.deepEqual(parseLengthConstraint('no more than 40 words please'), {
    unit: 'words', operator: 'max', count: 40,
  });
  assert.deepEqual(parseLengthConstraint('give me a 100 word linkedin post'), {
    unit: 'words', operator: 'approx', count: 100,
  });
  assert.deepEqual(parseLengthConstraint('draft a 280-character tweet about our launch'), {
    unit: 'characters', operator: 'approx', count: 280,
  });
  assert.deepEqual(parseLengthConstraint('keep your answer to around 60 words'), {
    unit: 'words', operator: 'approx', count: 60,
  });
});

test('a bare deliverable count is approximate, never exact', () => {
  // The regression that made drafting expensive: "a 100 word post" used to
  // demand EXACTLY 100 words and retried three times to get there.
  const parsed = parseLengthConstraint('write a 100 word post');
  assert.equal(parsed?.operator, 'approx');
  assert.equal(verifyLengthConstraint('x '.repeat(94).trim(), parsed).ok, true, '94 words should satisfy ~100');
  assert.equal(verifyLengthConstraint('x '.repeat(70).trim(), parsed).ok, false, '70 words should not satisfy ~100');
});

test('a descriptive figure does not mask a real instruction later in the message', () => {
  assert.deepEqual(
    parseLengthConstraint('our tagline is 60 characters long — draft me a 30 word replacement'),
    { unit: 'words', operator: 'approx', count: 30 },
  );
});

test('verification honours each operator', () => {
  assert.equal(verifyLengthConstraint('one two three', { unit: 'words', operator: 'exact', count: 3 }).ok, true);
  assert.equal(verifyLengthConstraint('one two three four', { unit: 'words', operator: 'exact', count: 3 }).ok, false);
  assert.equal(verifyLengthConstraint('abcd', { unit: 'characters', operator: 'max', count: 5 }).ok, true);
  assert.equal(verifyLengthConstraint('abcdef', { unit: 'characters', operator: 'max', count: 5 }).ok, false);
});

test('descriptions read naturally for each operator', () => {
  assert.equal(describeLengthConstraint({ unit: 'words', operator: 'exact', count: 50 }), 'exactly 50 words');
  assert.equal(describeLengthConstraint({ unit: 'characters', operator: 'max', count: 280 }), 'at most 280 characters');
  assert.match(describeLengthConstraint({ unit: 'words', operator: 'approx', count: 100 }), /^about 100 words/);
});
