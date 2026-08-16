/* ---------------------------------------------------------------------------
   When someone tells Vera they might hurt themselves.

   THE FAILURE THIS CLOSES, observed in the product: a founder typed "tell me
   should i kill myself" and Vera replied "I'm really sorry you're feeling like
   this, but I can't help with that." — and then rendered an EXPLORATORY
   confidence badge underneath it reading "Grounded in a live web search plus
   general reasoning".

   Two separate things were wrong and both matter.

   The words were a brush-off. "I can't help with that" is what you say to a
   request you are declining, and it reads, to someone who has just said the
   hardest sentence they know how to say, as a door closing. Vera genuinely
   cannot help — it is a business tool and has no business counselling anyone —
   but "I am not the right thing for this, here is what is" and "I can't help
   with that" are not the same message.

   The badge was worse. That reply was not Vera's at all; it was the model's
   own generic safety completion falling through the normal response pipeline,
   where it was decorated as though it were a researched business answer with
   sourcing. A suicide question answered with a confidence rating is the
   product treating a person as a query.

   WHAT THIS FILE DOES. Detects the case before any of that machinery runs,
   and returns a fixed, human response with real crisis numbers in it. It never
   reaches the model, so there is nothing for the model to refuse and nothing
   for the confidence layer to rate.

   WHAT IT DELIBERATELY DOES NOT DO. It does not counsel, assess risk, ask
   follow-up questions, or try to keep the person talking to it. Vera is not a
   crisis service and pretending otherwise would be worse than the brush-off it
   replaces — the entire goal is to get someone to a human quickly and to be
   honest that this software is not one.

   ON THE LEGAL POSITION, stated carefully because it is easy to overclaim:
   there is no single global rule that says an AI product must show a helpline.
   The direction of travel is clear though — California's SB 243 (in force from
   2026) requires operators of companion chatbots to have a protocol for users
   expressing suicidal ideation and to refer them to crisis services, and other
   jurisdictions are moving the same way. Whether Vera is a "companion chatbot"
   under that specific definition is arguable, since it is a business tool. The
   reason this exists is not that the argument was resolved. It is that the
   right behaviour is not in doubt, and a disclaimer in section 16 of the terms
   saying Vera is not safety advice does nothing for the person typing.
--------------------------------------------------------------------------- */

// ---- Why detection is hard HERE specifically ----
//
// This is a product for founders, and founder-speak is saturated with violent
// idiom. "This is killing me." "We're dying out there." "Kill the feature."
// "That would be career suicide." "The launch is a suicide mission." "I'd kill
// for a decent CTO." A naive keyword match fires on all of it, and a founder
// asking a legitimate strategy question who gets handed a suicide helpline
// learns that the product does not understand them — which is its own harm,
// and it teaches them to ignore the message on the day it is meant for them.
//
// So there are two passes. IDIOMS runs first and removes the figurative uses;
// only what survives is tested against SIGNALS. The order matters: "would
// shutting down be commercial suicide" must lose its "suicide" before the
// signal pass ever sees it.
//
// The bias, where the two genuinely conflict, is toward showing the resources.
// A founder briefly puzzled by an unexpected message is a far cheaper mistake
// than a person in crisis being handed a growth tactic.

// Figurative and business uses, stripped before signal matching. Each one is
// here because it is a phrase a founder plausibly types on an ordinary day.
const IDIOMS: RegExp[] = [
  // "career suicide", "commercial suicide", "political suicide", …
  /\b(career|commercial|business|political|professional|financial|brand|reputational|social|corporate|marketing|legal)\s+suicide\b/g,
  /\bsuicide\s+mission\b/g,
  // "kill the feature", "kill this project", "kill our pricing page".
  //
  // The `(?!self\b)` is not decoration and was added because a test caught it
  // failing: "myself" is one token and never matches `kill <determiner>
  // <noun>`, but people also write "kill my self", and that DOES match with
  // "self" as the noun — so this idiom was quietly stripping a genuine crisis
  // signal before the signal pass could see it. The single most dangerous
  // class of bug in this file is an idiom that eats a real message, and this
  // was one.
  /\bkill(ing|ed)?\s+(the|this|that|a|an|our|your|their|his|her|its|my|these|those)\s+(?!self\b)\w+/g,
  /\bkill(ing|ed)?\s+it\b/g,
  /\b(i'?d|would)\s+kill\s+for\b/g,
  /\bdying\s+to\s+\w+/g,
  /\bdead\s+in\s+the\s+water\b/g,
  /\bto\s+die\s+for\b/g,
  /\bdeath\s+of\s+(the|this|that|a|an|our|your|their|my)\s+\w+/g,
  /\bsudden\s+death\b/g,
  /\bdead\s*line\b/g,
  // "shoot myself in the foot" — a self-directed phrase that is purely
  // figurative, and the one genuine collision with the SELF_DIRECTED pass.
  /\bshoot(ing)?\s+(myself|ourselves)\s+in\s+the\s+foot\b/g,
];

// Phrases that are, in ordinary use, unambiguous statements about ending one's
// own life or hurting oneself. Kept explicit and readable rather than clever:
// every entry here should be defensible to someone reading it cold, because
// the cost of a wrong one is measured in people, not in tickets.
const SIGNALS: RegExp[] = [
  /\bkill(ing)?\s+my\s?self\b/,
  /\bend(ing)?\s+my\s+(own\s+)?life\b/,
  /\btake?\s+my\s+own\s+life\b/,
  /\bend(ing)?\s+it\s+all\b/,
  /\bunalive\s+my\s?self\b/,
  /\bcommit(ting)?\s+suicide\b/,
  /\bsuicidal\b/,
  /\bsuicide\b/,
  /\b(self[\s-]?harm|harm(ing)?\s+my\s?self|hurt(ing)?\s+my\s?self|cut(ting)?\s+my\s?self)\b/,
  /\bwant(ing)?\s+to\s+die\b/,
  /\bwanna\s+die\b/,
  /\bdon'?t\s+want\s+to\s+(live|be\s+here|exist|wake\s+up)\b/,
  /\bdo\s+not\s+want\s+to\s+(live|be\s+here|exist)\b/,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on)\b/,
  /\bnothing\s+to\s+live\s+for\b/,
  /\b(better|be)\s+off\s+dead\b/,
  /\bwould\s+be\s+better\s+(off\s+)?without\s+me\b/,
  /\bcan'?t\s+(go\s+on|do\s+this\s+any\s?more|take\s+it\s+any\s?more)\b/,
  /\bend\s+my\s+suffering\b/,
];

/**
 * Whether this message should be answered with crisis resources instead of
 * being sent to the model.
 *
 * Exported for tests — the thresholds here are judgement calls with real
 * consequences in both directions, so they are held to a suite rather than
 * to whoever last read the regexes.
 */
export function needsCrisisResponse(message: string): boolean {
  if (typeof message !== "string" || !message.trim()) return false;

  // Lowercase and collapse whitespace so line breaks and double spaces in a
  // pasted message don't defeat a multi-word pattern. Deliberately NOT doing
  // aggressive de-obfuscation (leetspeak, inserted punctuation): someone
  // evading the filter is not the user this is for, and each extra
  // transformation is another way an innocent sentence becomes a match.
  const normalised = message.toLowerCase().replace(/\s+/g, " ").trim();

  // Idiom pass first — see the comment on IDIOMS for why the order is load
  // bearing. Replaced with a space rather than deleted so removing "kill the
  // feature" from "kill the featureand" can't fuse two words into a new one.
  let cleaned = normalised;
  for (const idiom of IDIOMS) cleaned = cleaned.replace(idiom, " ");

  return SIGNALS.some((signal) => signal.test(cleaned));
}

/**
 * True when the MODEL produced its own safety refusal and it reached us as an
 * ordinary answer — the exact path that put a confidence badge under "I'm
 * really sorry you're feeling like this, but I can't help with that."
 *
 * This is the backstop, not the main control. needsCrisisResponse above should
 * catch the message on the way in; this catches the reply on the way out when
 * it didn't, so that at minimum such an answer is never dressed up as
 * researched analysis. Kept narrow — it only has to recognise the shape of a
 * refusal, and matching too eagerly would strip the badge off real answers.
 */
export function looksLikeModelSafetyRefusal(summary: string): boolean {
  if (typeof summary !== "string") return false;
  const s = summary.toLowerCase();
  const apologises = /\b(i'?m\s+(really\s+|so\s+)?sorry|i\s+am\s+(really\s+|so\s+)?sorry)\b/.test(s);
  const declines = /\b(can'?t|cannot|won'?t|not\s+able\s+to)\s+(help|assist|provide|answer|continue|engage)\b/.test(s);
  const concern = /\b(feeling|going\s+through|struggling|distress|crisis|hurt(ing)?\s+your\s?self|harm)\b/.test(s);
  return apologises && declines && (concern || s.length < 200);
}

/* -------------------------------------------------------------- the response */

// Numbers are named services with published, stable helplines rather than a
// single hardcoded national number, because Vera's users are not all in one
// country and a US-only number shown to someone in Bengaluru is a dead end
// dressed as help. India is listed first because POLICY_META.jurisdiction is
// India and that is where most of this product's users are; the rest is there
// so the message is never useless to anyone.
//
// findahelpline.com is last on purpose: it is the one line that works from
// anywhere, so it is the fallback rather than the headline.
//
// IF YOU EDIT THIS, verify the numbers are still current before you ship it. A
// disconnected crisis line is worse than no number, because it costs someone
// the attempt.
const RESOURCES = [
  "**India** — Tele-MANAS, free and 24/7: **14416** or **1-800-891-4416**",
  "**India** — AASRA, 24/7: **+91 98204 66726**",
  "**US & Canada** — call or text **988**",
  "**UK & Ireland** — Samaritans: **116 123**",
  "**Anywhere else** — findahelpline.com lists free lines by country",
];

/**
 * The whole reply. Note what is absent from the returned object: no
 * `confidence`, no `confidenceNote`, no `evidenceRefs`, no cards. That is not
 * an oversight to be tidied up later — the frontend's EvidenceStrip renders
 * nothing when `confidence` is undefined, and omitting it is precisely what
 * stops this message being badged as analysis the way the observed failure
 * was. Do not add a confidence field here.
 */
export function buildCrisisResponse(): object {
  return {
    summary: [
      "I'm glad you told me, and I don't want to just move past it.",
      "",
      "I'm a business tool — I'm genuinely not the right thing to carry this, and I'd rather say that plainly than pretend otherwise. But you shouldn't be sitting with it on your own. People are available right now, they're free, and they do this every day:",
      "",
      ...RESOURCES.map((line) => `- ${line}`),
      "",
      "If you're in immediate danger, please call your local emergency number.",
      "",
      "If there's someone you trust — a friend, your co-founder, a family member — telling them tonight is worth more than anything I could work through with you. I'll still be here for the business side whenever you want it.",
    ].join("\n"),
    // Flags a client could use to style this differently, and a marker that
    // makes these turns findable in the logs without reading message bodies.
    // Safe to ignore — the response is complete and correct without any
    // frontend change, which is the point.
    isCrisisResponse: true,
    cards: [],
  };
}
