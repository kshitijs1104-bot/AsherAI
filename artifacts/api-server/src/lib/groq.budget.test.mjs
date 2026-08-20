import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------------------------------------------------------------------
   THE TEST THAT WOULD HAVE CAUGHT THE TPM WALL COMING BACK.

   The per-request prompt assembly (buildVenusPrompt) fixed the static prompt
   in 2026-08-14 and still works. The wall returned anyway, without a single
   line of the budgeting code changing, and the reason is the thing this file
   exists to make visible:

     EVERY MEMORY BLOCK IS EMPTY ON THE DAY IT SHIPS.

   Cross-chat recall, own-decision history, open-session recommendations,
   goals, the dossier — each one costs nothing for a brand-new account and
   grows as the founder uses the product. So a budget that fits at launch can
   be over the ceiling a week later with no deploy in between. The failure
   arrives looking like "it randomly went back to hitting TPM", which is
   exactly how it was reported.

   These assertions are deliberately written as MEASUREMENTS with the numbers
   spelled out, not as a pass/fail on a magic constant. When one of them
   fails, the message tells the next person what the real budget is and what
   the prompt now costs, so the decision (shed more / raise the tier / trim a
   section) is made with the arithmetic in hand instead of by guessing.
--------------------------------------------------------------------------- */

const {
  buildVenusPrompt,
  estimateTokens,
  tpmLimitForModel,
  TPM_SAFETY_MARGIN,
  MIN_USABLE_MAX_TOKENS,
} = await import('./groq.ts');

const MODEL = 'openai/gpt-oss-120b';
const budget = () => Math.floor(tpmLimitForModel(MODEL) * TPM_SAFETY_MARGIN);

const MODES = ['strategy', 'drafting', 'capability', 'open_ended', 'document'];

test('every prompt mode is measured, and the free-tier budget is stated', () => {
  const b = budget();
  assert.equal(b, 6800, `free-tier budget changed to ${b} — if the paid tier is now live this test's expectations need revisiting, not deleting`);

  for (const mode of MODES) {
    const bare = estimateTokens(buildVenusPrompt({ mode }));
    const withMemory = estimateTokens(
      buildVenusPrompt({ mode, hasOwnHistory: true, hasOpenSession: true, hasCrossChat: true }),
    );
    assert.ok(withMemory >= bare, `${mode}: memory flags should only add tokens`);
    // Recorded rather than asserted against a ceiling — see the next test for
    // the one that actually bites.
    console.log(`      ${mode.padEnd(11)} static=${String(bare).padStart(5)}t  +memory-rules=${String(withMemory).padStart(5)}t`);
  }
});

test('the LIGHT modes still leave usable room for the founder’s own context', () => {
  const b = budget();
  // Everything except strategy has to survive a real request: the prompt, the
  // answer we must reserve for, and a modest amount of the founder's own
  // material. If one of these stops fitting, the shedding in routes/ai.ts is
  // no longer enough and the mode itself needs trimming.
  const CONTEXT_FLOOR = 1500; // dossier + business context + message + history

  for (const mode of ['drafting', 'capability', 'open_ended', 'document']) {
    const cost =
      estimateTokens(buildVenusPrompt({ mode, hasOwnHistory: true, hasOpenSession: true, hasCrossChat: true })) +
      MIN_USABLE_MAX_TOKENS +
      CONTEXT_FLOOR;
    assert.ok(
      cost <= b,
      `${mode} needs ${cost}t (prompt + ${MIN_USABLE_MAX_TOKENS}t answer + ${CONTEXT_FLOOR}t context) against a ${b}t budget — over by ${cost - b}t`,
    );
  }
});

test('strategy mode does NOT fit the free tier, and that is a known, handled fact', () => {
  /* This is the finding, pinned so nobody spends another afternoon looking
     for the regression that "broke" it. Strategy mode is ~5,849 tokens. Add
     only the answer reservation Groq charges up front (MIN_USABLE_MAX_TOKENS,
     1,200) and it is already over 6,800 — with ZERO context, no dossier, no
     precedents, no history, no message.

     There is no arrangement of the founder's data that makes full strategy
     mode fit on the free tier. routes/ai.ts therefore downgrades it rather
     than sending a request that cannot succeed (see the pre-flight budget
     pass there). That is a deliberate, logged trade, not a silent
     degradation — and it stops happening by itself on the paid tier.

     IF THIS TEST STARTS FAILING because strategy now fits: good. Something
     was trimmed or the tier changed. Update the comment in routes/ai.ts that
     explains the downgrade, and consider removing it. */
  const b = budget();
  const strategyFloor = estimateTokens(buildVenusPrompt({ mode: 'strategy' })) + MIN_USABLE_MAX_TOKENS;

  assert.ok(
    strategyFloor > b,
    `strategy now fits the free tier (${strategyFloor}t vs ${b}t) — the downgrade path in routes/ai.ts may no longer be needed`,
  );
});

test('open_ended is a real fallback for strategy, not a rounding error', () => {
  // The downgrade in routes/ai.ts is only worth making if it frees a
  // meaningful amount. If these two ever converge, the downgrade is doing
  // damage for nothing and should be removed.
  const strategy = estimateTokens(buildVenusPrompt({ mode: 'strategy' }));
  const openEnded = estimateTokens(buildVenusPrompt({ mode: 'open_ended' }));
  const freed = strategy - openEnded;
  assert.ok(
    freed >= 2000,
    `downgrading strategy -> open_ended frees only ${freed}t — no longer worth the loss of the reasoning stack`,
  );
});
