import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeReplyToPriorTurn, buildCorrectionInstruction } from './turnIntent.ts';

// Run with:  npx tsx --test src/lib/turnIntent.test.mjs   (from artifacts/api-server)
//
// Every "should be a reply" case below is a real message from the live
// transcript that produced a "Got it — noted: ..." non-answer, or a
// re-statement of the rejected recommendation. Every "should NOT be a reply"
// case is a genuine context dump that must keep reaching the
// acknowledgment/intake path — this guard has to fail in the right direction,
// so the negative controls matter as much as the positives.

const PRIOR = 'Yes, allocating about 25% of your testing budget to operational convenience experiments is a solid move. It lets you validate the time-savings hypothesis without overspending.';

test('the live failure transcript is recognised as replies, not context dumps', () => {
  const corrections = [
    'no im saying 25% wld be losing out on too much profit',
    'not testing budget giving 25% as dscount is unreasonable',
    'im correcting u',
    'im saying wldnt giving 20% for discounts be too much loss',
    'ans my question',
  ];
  for (const message of corrections) {
    assert.equal(looksLikeReplyToPriorTurn(message, PRIOR), true, `should read as a reply: "${message}"`);
  }
});

test('other common correction shapes with no question word and no "?"', () => {
  const corrections = [
    "thats not what i asked",
    'wrong number',
    'u misread my question',
    'you said 25% of budget, i said discount',
    'actually the churn figure was 8 not 18',
    'i meant the second option',
    'nope',
    'but thats the opposite of what i told u',
    'that answer is about something else',
  ];
  for (const message of corrections) {
    assert.equal(looksLikeReplyToPriorTurn(message, PRIOR), true, `should read as a reply: "${message}"`);
  }
});

test('genuine business context statements are NOT treated as replies', () => {
  const contextDumps = [
    'We operate a subscription platform for gyms, 450 paying customers, $35,000 MRR',
    "I'm the founder of a HealthTech startup helping clinics with scheduling",
    'we run a quick-commerce grocery store in Pune competing with Zepto',
    'our churn is 8% monthly and rising',
    'my app is at 12k downloads and pre-revenue',
  ];
  for (const message of contextDumps) {
    assert.equal(looksLikeReplyToPriorTurn(message, PRIOR), false, `should NOT read as a reply: "${message}"`);
  }
});

test('nothing is a reply when there is no prior turn to reply to', () => {
  assert.equal(looksLikeReplyToPriorTurn('no im saying 25% is too much', ''), false);
  assert.equal(looksLikeReplyToPriorTurn('im correcting u', '   '), false);
});

test('empty or whitespace messages are never replies', () => {
  assert.equal(looksLikeReplyToPriorTurn('', PRIOR), false);
  assert.equal(looksLikeReplyToPriorTurn('   ', PRIOR), false);
});

test('correction instruction forbids the observed failure modes', () => {
  const instruction = buildCorrectionInstruction(null, null);
  // Restating the rejected answer behind an agreeable opener — what Vera
  // actually did after "im correcting u".
  assert.match(instruction, /Do not open with "Yes"/);
  assert.match(instruction, /repeating the previous recommendation with new wording/i);
  // Answering a correction with an acknowledgment — the other half of the bug.
  assert.match(instruction, /Never respond to a correction with an acknowledgment/i);
  assert.match(instruction, /Got it — noted/);
  // Re-reading the ambiguous phrase is the actual recovery move.
  assert.match(instruction, /resolved an ambiguous phrase the wrong way/i);
});

test('correction instruction carries the detected issue but keeps the founder authoritative', () => {
  const instruction = buildCorrectionInstruction('read a discount percentage as a budget share', 'misread_intent');
  assert.match(instruction, /read a discount percentage as a budget share/);
  assert.match(instruction, /misread_intent/);
  assert.match(instruction, /the founder's own words in the current message are the authority/);
});
