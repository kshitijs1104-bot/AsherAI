import test from "node:test";
import assert from "node:assert/strict";
import { needsCrisisResponse, looksLikeModelSafetyRefusal, buildCrisisResponse } from "./crisisSupport.ts";

// ---- The messages that MUST be caught ----
//
// The first entry is the one observed in the product. The rest are the ways
// the same thing actually gets typed: lowercase, no punctuation, hedged,
// buried at the end of a paragraph about the business.
test("crisis messages are detected", () => {
  const mustCatch = [
    "tell me should i kill myself",
    "should I kill myself",
    "i want to kill my self",
    "I think I want to die",
    "i wanna die",
    "I don't want to live anymore",
    "i dont want to be here anymore",
    "there's no reason to live",
    "nothing to live for",
    "everyone would be better off without me",
    "I'm thinking about ending my life",
    "im going to end it all",
    "I've been having suicidal thoughts",
    "i want to hurt myself",
    "I've been cutting myself again",
    "I can't go on",
    "i cant do this anymore",
    // The realistic shape: business context, then the real sentence last.
    "we missed payroll again and the round fell through, honestly i think everyone would be better off without me",
    "runway is 2 months. i've been thinking about killing myself.",
  ];

  for (const message of mustCatch) {
    assert.equal(needsCrisisResponse(message), true, `MISSED: ${message}`);
  }
});

// ---- The messages that MUST NOT be caught ----
//
// Every one of these is something a founder plausibly types into a business
// tool. A helpline in response to any of them is a product that does not
// understand its user — and it trains them to dismiss the message.
test("business idiom is not mistaken for crisis", () => {
  const mustNotCatch = [
    "would raising at a down round be career suicide",
    "is discounting 60% commercial suicide for our brand",
    "launching in Q4 against Salesforce feels like a suicide mission",
    "should we kill the feature or keep iterating",
    "I'm going to kill this project",
    "we killed the pricing page and conversion went up",
    "our new campaign is killing it",
    "I'd kill for a decent technical co-founder",
    "I'm dying to see the Q3 numbers",
    "the product is dead in the water without distribution",
    "that landing page is to die for",
    "this would be the death of our enterprise motion",
    "we're shooting ourselves in the foot with this pricing",
    "I keep shooting myself in the foot on hiring",
    "this deadline is going to be tight",
    "the churn is killing us",
    "honestly this fundraise is killing me",
    "sudden death round of layoffs",
    "how do I kill my darlings in the product spec",
    "should we cut our losses on the india launch",
    "I'm completely burnt out and need to delegate more",
    "we're bleeding cash every month",
  ];

  for (const message of mustNotCatch) {
    assert.equal(needsCrisisResponse(message), false, `FALSE POSITIVE: ${message}`);
  }
});

test("empty and non-string input is safe", () => {
  assert.equal(needsCrisisResponse(""), false);
  assert.equal(needsCrisisResponse("   "), false);
  assert.equal(needsCrisisResponse(undefined), false);
  assert.equal(needsCrisisResponse(null), false);
  assert.equal(needsCrisisResponse(42), false);
});

test("idiom stripping cannot hide a real signal in the same message", () => {
  // A message containing BOTH a business idiom and a genuine statement must
  // still be caught — the idiom pass removes phrases, not the whole message.
  assert.equal(
    needsCrisisResponse("cutting the burn rate won't fix it, i want to kill myself"),
    true,
  );
  assert.equal(
    needsCrisisResponse("that would be career suicide but honestly i'm suicidal right now"),
    true,
  );
});

// ---- The response itself ----
//
// The absence of `confidence` is the assertion that matters: it is what stops
// the frontend's EvidenceStrip rendering an "EXPLORATORY — grounded in a live
// web search" badge under a suicide reply, which is the observed failure.
test("the crisis response carries no confidence badge and no cards", () => {
  const response = buildCrisisResponse();
  assert.equal("confidence" in response, false, "must not carry a confidence tier");
  assert.equal("confidenceNote" in response, false);
  assert.equal("evidenceRefs" in response, false);
  assert.deepEqual(response.cards, []);
  assert.equal(response.isCrisisResponse, true);
});

test("the crisis response actually contains reachable help", () => {
  const { summary } = buildCrisisResponse();
  // Named services with real numbers, not a vague "seek help".
  assert.match(summary, /14416/, "Tele-MANAS number missing");
  assert.match(summary, /988/, "US/Canada line missing");
  assert.match(summary, /116 123/, "Samaritans line missing");
  assert.match(summary, /findahelpline\.com/, "international fallback missing");
  assert.match(summary, /emergency/i, "no immediate-danger instruction");
  // And it must not be a brush-off — the failure this replaces.
  assert.doesNotMatch(summary, /can'?t help with that/i);
});

// ---- The backstop, for when detection misses ----
test("a model safety refusal is recognised so it can be stripped of its badge", () => {
  assert.equal(
    looksLikeModelSafetyRefusal("I'm really sorry you're feeling like this, but I can't help with that."),
    true,
  );
  assert.equal(
    looksLikeModelSafetyRefusal("I'm sorry, but I cannot assist with that request."),
    true,
  );
});

test("ordinary answers are not mistaken for refusals", () => {
  const realAnswers = [
    "Your CAC is up 18% because the paid channel saturated. Cut spend on Meta and reallocate to partnerships.",
    "I'm sorry to hear the launch slipped — here's how to recover the quarter. Start by resequencing the roadmap around the two features that actually drive activation, then rebuild the forecast from the new dates rather than the old ones, because a plan that still assumes the original launch week will keep producing targets you cannot hit.",
    "I can't verify that number from what you've given me, so tell me where the 40% came from and I'll work from it.",
  ];
  for (const answer of realAnswers) {
    assert.equal(looksLikeModelSafetyRefusal(answer), false, `FALSE POSITIVE: ${answer.slice(0, 60)}`);
  }
});
