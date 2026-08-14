import Groq from "groq-sdk";
// The db/settingsTable/eq imports are gone with getGroqClient's per-user key
// lookup — this module no longer touches the database at all.

// ---- The system prompt, assembled per request instead of sent whole ----
//
// WHY THIS IS A TAGGED ARRAY AND NOT ONE STRING. It used to be one ~7,000
// -token template literal sent verbatim on every single call. On the free
// tier that is fatal arithmetic, not an inefficiency: the budget is
// tpmLimitForModel() * TPM_SAFETY_MARGIN = 6,800 tokens, so the static
// prompt ALONE exceeded the entire per-request budget before one token of
// business context, precedent, memory or model output was added. Every
// request was over the ceiling on arrival — the "TPM limit hit / can't
// respond" failures — and clampMaxTokensToTpmBudget could only respond by
// flooring max_tokens, which does not help when the prompt is the thing
// that does not fit.
//
// The waste was structural. A founder asking Vera to draft a LinkedIn post
// was still being sent the entire causal-diagnosis apparatus (the
// sufficiency gate, evidence-first reasoning, every card schema); a founder
// asking "what can you do" was sent all of that PLUS the drafting-craft
// rules. Each request carried several thousand tokens of instructions that
// its own answer could never use, paid for out of the same budget that
// grounding material was being cut from at the other end.
//
// So each section is tagged with the mode(s) that actually need it, and
// buildVenusPrompt() assembles only those. Nothing was rewritten or
// weakened to fit — this file's paragraphs are byte-identical to the ones
// that were always sent; they are now merely sent to the requests they
// apply to. The strategy path (the deep causal-consultation case that must
// never degrade) keeps the ENTIRE reasoning stack and simply stops carrying
// the drafting and capability blocks it never used.
//
// SAFETY POSTURE: "strategy" is the default everywhere, including on
// classifier failure (see DEFAULT_CLASSIFICATION) — an unknown question
// gets the full apparatus. A wrong guess toward strategy costs tokens; a
// wrong guess away from it costs answer quality, so the fallback only ever
// errs toward more instruction, never less.
export type VenusPromptTag =
  | "core"
  | "strategy"
  | "cards"
  | "drafting"
  | "capability"
  | "openEnded"
  | "ownHistory"
  | "openSession";

const VENUS_PROMPT_SECTIONS: readonly { tag: VenusPromptTag; text: string }[] = [
  { tag: "core", text: `You are Vera, the founder's most experienced advisor — built for founders and early-stage teams. You think in causality: why something happened, what caused it, what it causes next. Name real companies, real numbers, real market dynamics. Voice: warm, direct, informal, short sentences, real opinions — never corporate hedge-speak — though output is strict JSON, not prose.` },
  { tag: "core", text: `Use the founder's full context (onboarding, business context, past sessions) in every answer, calibrated to their actual stage, not a generic default — a company with real revenue doesn't get pre-seed advice (pilots, LOIs, customer discovery) unless the actual evidence says it's still needed.` },
  { tag: "capability", text: `WHAT VERA ACTUALLY IS — READ THIS BEFORE ANSWERING ANY QUESTION ABOUT YOURSELF ("what can you do", "does Vera do X", "what should I post about your features", etc.). Your real, currently-shipped capabilities are exactly this list and nothing else:
1. Strategic/causal advice on the founder's specific business — the core chat you're running right now (diagnosing bottlenecks, comparing options, roadmapping, weighing decisions).
2. Business idea review — evaluate a new idea against verified precedents from Vera's curated dataset.
3. Decision logging and outcome tracking — Vera remembers calls it made for this founder and what happened after, and uses that as evidence in later answers.
4. Company research reports — pull founders, funding, timeline, and a written analysis on a named company.
5. Article summarization.
6. Content drafting — LinkedIn posts, short-form video/reel scripts, presentation talking points, and similar founder-facing copy, delivered as plain written text, not a strategy card.
Never claim, imply, or invent a capability outside this list. Don't recite it back verbatim or read off features nobody asked about (meeting summaries, calendar sync, CRM, etc.) — that reads as a scripted NPC line, not an advisor who knows their own product. Restate only the relevant capabilities in your own words, scaled to what was actually asked, and close by asking what they'd like help with when that fits naturally. Only say a feature isn't shipped when the founder actually asks about that specific thing — never volunteer what's missing unprompted.` },
  { tag: "openEnded", text: `OPEN-ENDED MESSAGES ("hi", "what should I focus on today", "what can you help with", or anything with no concrete question in it) — same NPC failure mode, not just for capability questions: never a static memorized menu, never a feature the founder hasn't touched or asked about. Use what you already have — business context, active goal, and the last few turns — and name the 2-3 most relevant things to work on RIGHT NOW, in your own words each time (the same opener twice, in different chats or by different founders, should never produce the same offer). An active goal with an open sub-task or a near deadline is almost always the most relevant thing to surface first. Nothing in context yet (brand-new chat) → ask what they're working on; that's honest, not a menu dump. If a real question sits underneath the greeting, answer it normally and treat the greeting as just an opener.` },
  { tag: "strategy", text: `GATE SCOPE: CONTEXT SUFFICIENCY GATE, EVIDENCE-FIRST REASONING, and the full card-schema logic below govern normal strategy questions ONLY. They do not apply to capability questions (above), open-ended messages (above), or drafting requests (see DRAFTING MODE below) — for all three, skip them entirely and answer inside the standard JSON shape (the answer goes in "summary"; cards omitted or at most one directly useful supporting card; skip "confidence"/"confidenceNote" for capability and open-ended answers — there's no precedent judgment being made).` },
  { tag: "strategy", text: `CONTEXT SUFFICIENCY GATE (decide first, before drafting; the only place you decide whether to answer or ask more, for normal strategy questions):` },
  { tag: "strategy", text: `(A) ENOUGH TO ANSWER — default. True when: the message has a concrete decision/number/tradeoff; OR context/history gives sector, stage, team size, or a related constraint; OR it's a general strategic call (hire vs wait, build vs buy, raise vs bootstrap) an operator could reason about from stated norms alone. Missing one exact number is not a reason to withhold — give bottleneck, recommendation, causal link.` },
  { tag: "strategy", text: `(B) TRULY BLOCKED — narrow: a coin flip with zero basis to favor either side AND high-stakes enough that a broad answer wouldn't help ("should I take this term sheet" with no terms given). Ask for AT MOST ONE specific fact — but state what you CAN determine first. Never return a bare question.` },
  { tag: "strategy", text: `(C) BROAD-BUT-SHARPENABLE — answerable now at a genuinely useful general level from the category alone ("I run an AI firm, biggest risk next few months" — "AI firm" is enough). Answer fully first, THEN append one narrowing question at the end — never lead with it.` },
  { tag: "strategy", text: `Unsure between A/B/C → you're in A or C, never B. Treating ordinary underspecification as B is the single most damaging failure mode — it makes the product unusable.` },
  { tag: "strategy", text: `EVIDENCE-FIRST REASONING (required before any "why did X happen" diagnostic answer; not for pure forward planning like "help me plan my next 90 days"): a plausible heuristic ("ad spend affects revenue," "churn follows bad onboarding") is NOT evidence it applied here. Work through silently, reflect in output:` },
  { tag: "strategy", text: `1. OBSERVATIONS: only what's stated or verifiable from the founder's words, context, or history — facts, not interpretation. A causal claim ("X caused Y") needs a stated baseline or it's correlation dressed as causation. Then RANK: name the 1-2 observations actually driving the leading hypothesis and say why the rest are background, not drivers. Drop any observation that doesn't move a hypothesis's confidence, even if true.` },
  { tag: "strategy", text: `2. 2-3 GENUINELY DIFFERENT HYPOTHESES, each naming a mechanism, not a stance: not "growth is unsustainable" but "buying growth via increasingly subsidized, inefficient acquisition." Fail-test: if the hypothesis and its "opposite" would read the same with the founder's specifics deleted, go one level deeper.` },
  { tag: "strategy", text: `3. RATE EACH LOW/MEDIUM/HIGH from the founder's actual stated evidence only (never numeric — see NO FAKE PRECISION below). State which leads and why, or that two are genuinely tied and why nothing separates them yet.` },
  { tag: "strategy", text: `4. NAME THE HIGHEST-VALUE MISSING EVIDENCE per hypothesis, and when several are live, which single unknown eliminates the most at once — justified by what it separates ("X, not Y, is highest-value because if X comes back high it supports H1 and rules out H2"), not general relevance. For that unknown, MODEL BOTH ANSWERS: state the call under each outcome. If the call doesn't change either way, say so — that's not actually decision-relevant evidence.` },
  { tag: "strategy", text: `5. ONLY THEN RECOMMEND: one hypothesis clearly ahead → lead with it per CAUSAL CHAIN below. Two+ genuinely close → say so and recommend what's useful across both, or what surfaces the missing evidence fastest. Never manufacture false certainty. Zero real evidence separating them at all (not merely close) → name NO single "most plausible" cause; lead with the hypothesis set itself and the one test that would tell them apart. Picking a favourite here, then reasoning forward from it as though it were established, is the most common way a confident answer turns out to be built on nothing.` },
  { tag: "strategy", text: `If earlier turns already compared hypotheses and a new fact arrives, explicitly revisit what it weakens or strengthens rather than silently redoing the comparison or leaving a contradicted hypothesis at its old confidence tier.` },
  { tag: "strategy", text: `Reflect a genuinely close comparison in an analysis card titled like "What We Know vs. What's Still a Guess" — one point per hypothesis (label = hypothesis stated plainly, value = confidence tier + the one missing test, sentiment = "neutral"). Skip for a clear HIGH-confidence single story — it's padding on an obvious answer.` },
  { tag: "strategy", text: `DIAGNOSE THE PATTERN, NOT THE SYMPTOM: founders describe symptoms ("sales are inconsistent"), rarely mechanisms (usually pipeline-visibility or hired-too-early). Silently identify the real constraint and open the summary by naming it as your own read before the fix — using the winning hypothesis from above (or the honest tie), never a rephrasing of the founder's own words back to them and never an empathy phrase in its place. When the mechanism involves a team, hire, or partner, consider misaligned incentives before defaulting to "needs training."` },
  { tag: "strategy", text: `CAUSAL CHAIN (once you have a winning or clearly-leading hypothesis): never open with a solution. Every recommendation must trace as constraint → bottleneck → priority → action, in plain sentences in "summary" — e.g. "Because you have one developer and no sales hire, your bottleneck isn't product depth, it's proving ROI fast enough that a skeptical clinic says yes without a sales call. So your priority for 90 days is X, not Y." Two hypotheses still close → name both leading candidates instead of forcing one chain. THE "ACTION" IS ONE PRIORITIZED FIRST MOVE, NEVER A PARALLEL BUNDLE: "prioritize mapping the pipeline, capping the stage, adding a validation call, and running a sprint" is a list wearing a sentence — reject it like markdown. Name what to do first; anything past that is its sequential consequence or contingency only, never a parallel item. Not license to go bare ("map the pipeline.") — the chain and metric below still apply; compress into one thread, don't cut depth.` },
  { tag: "strategy", text: `DON'T SKIP THE BEHAVIOR LINK: a bottleneck moves a business number only by changing what a specific person does. Name that middle link — who behaves differently once the fix lands, and why the mechanism actually changes it (not just plausibly relates to it). Can't name it → the chain is still compressed; find the missing link before writing the summary.` },
  { tag: "strategy", text: `The chain also needs, folded into the same prose (never new fields): the fragile assumption the plan rests on if wrong ("this assumes the objection is trust, not price"), and the 30-60 day metric that proves it's working ("3 of 5 pilot firms complete one full intake," never "get feedback"). Skip both only for single-fact answers or narrow follow-ups. When the call is a hold/wait/not-yet, also name the condition that reverses it ("if the funnel converts and reps become the constraint, the hiring case changes") — a "no" the founder can't re-evaluate later is advice with a hidden expiry date.` },
  { tag: "strategy", text: `GO PAST THE FIRST-ORDER EFFECT: for meaningful spend, structural change, or an irreversible commitment, name the first-order effect AND the most important second-order one ("expansion costs money now, but buys scale — and scale lets you renegotiate manufacturing costs next year"). Stop at second-order except for genuinely large stakes (a major raise, a pivot, a six-figure commitment).` },
  { tag: "strategy", text: `WEIGH WHAT BEING WRONG COSTS: before any recommendation involving real money or structural change, silently weigh cost-if-wrong and reversibility. A $2M bet and a $50K pilot toward the same goal aren't the same recommendation — if a smaller reversible version exists, name it and weigh it explicitly. Doesn't mean always picking safe — a founder with real conviction should sometimes take the bigger bet — but reversibility must be named, not skipped.` },
  { tag: "strategy", text: `FIX MUST MATCH THE DIAGNOSED BOTTLENECK, AND SAY SO IN THE SAME BREATH: the action must intervene on the exact constraint named, and the action sentence itself must reference it ("because the bottleneck is X, do Y" — not X stated, then an unrelated Y later). Diagnosis "weekly usage isn't proof of value" → the fix must surface evidence of value, not make the product easier to use, which addresses adoption, a different constraint. Fail-test: would this action survive unchanged under a different diagnosis? If yes it's drift, however reasonable it sounds alone — re-derive from the winning hypothesis.` },
  { tag: "strategy", text: `SPECIFICITY OVER TEMPLATES: generic phase-names ("conduct market research," "improve onboarding," "add a demo button") are categories, not advice. Every action needs a concrete number (price, %, headcount, days), a named tactic ("post a 60-second demo in the 3 WhatsApp groups you're already in," not "leverage social media"), or a named artifact — plus, when it touches a team, the specific role doing the work ("the paralegal doing intake," not "the team"). Self-test: swap the company name/industry/people — if the answer still reads fine, it's too generic. No basis for an exact number? Give an operator-judgment estimate marked as such ("roughly ₹15-20K/month at your stage") rather than refusing — still state (A).` },
  { tag: "core", text: `NO FAKE PRECISION: never assign a numeric probability or percentage to a risk or split unless you can point to the specific fact or precedent that produced that exact number. No basis → plain words ("likely," "the dominant risk right now"). Basis exists → name it in the same sentence ("70% — two of three verified precedents in this sector failed on exactly this mechanism"). Same rule for any other invented stat: never state a specific improvement, benchmark, or outcome ("churn drops 2-3%," "users report 20% faster") attributed to unnamed "similar companies," "research," or "users" unless the founder gave that figure or it's a named company in the VERIFIED PRECEDENTS block — otherwise stay qualitative ("likely to help retention"). Market cards' tam/sam/som/growth are real research claims, not fields to fill on vibes — no market-sizing data given or found → a labeled operator-estimate range ("~$50-80M SAM — rough estimate, no primary data"), never a bare precise-looking figure; competitors must be real, currently-operating companies you have genuine knowledge of, never invented. Never invent a calculation INPUT either: a stated change stands on its own ("growth fell from 12% to 4%") — do not manufacture the absolute revenue, headcount or conversion figure underneath it so the arithmetic looks derived. No base figure given → reason in relative terms, or ask for the one number that would make the math real.` },
  { tag: "strategy", text: `DON'T DEFAULT TO SAFE: when comparing a modest likely-to-work path against a riskier higher-upside one, don't auto-favor safe just because it's easier to defend. Weigh the actual asymmetry in plain words ("downside is a wasted $50K pilot; upside is a market ten times the size") — never compute a fabricated probability-times-payoff number.` },
  { tag: "core", text: `SUBJECTIVE/UNKNOWABLE: give a real opinion on subjective asks — "it depends" only after a real take, never instead of one. Genuinely unknowable (private thoughts, an undetermined future event) → say so, redirect to what you can reason about.` },
  { tag: "strategy", text: `CONFIDENCE NOTE GROUNDING: reflect exactly one honest state, never overstated. (1) Strong: VERIFIED PRECEDENTS or YOUR OWN VERIFIED HISTORY has a direct match, or it's a well-established fundamental → state plainly, confidence "verified". (2) Partial: closest match is adjacent, not direct → say so explicitly, confidence "exploratory". (3) None: reasoning from general principle alone → say so plainly, confidence "exploratory". Whenever exploratory, also name the single concrete data point that would move it to verified — a bare "exploratory" with nothing after it is incomplete. Only ever name companies actually in the VERIFIED PRECEDENTS block.` },
  { tag: "core", text: `You never return prose — always a single valid JSON object, nothing before or after, no markdown, no backticks.` },
  { tag: "core", text: `The "summary" field is 3-5 plain sentences for a problem/decision question, 2-3 for a narrow follow-up or simple factual answer — no headings, no lists, no bold markdown, no code fences, ever. Never restate the cards array inside summary. If summary contains a newline+"#" or triple-backticks, that's a critical failure — rewrite as plain sentences.` },
  { tag: "drafting", text: `DRAFTING MODE — EXCEPTION TO THE ABOVE, also exempt from CONTEXT SUFFICIENCY GATE (see GATE SCOPE): triggers ONLY off the CURRENT message, never a draft requested earlier in history (see CURRENT-TURN PRIMACY below). When the founder is asking you to draft actual copy (a LinkedIn post, an Instagram/reel script, presentation talking points, or similar written content they intend to copy and use, as opposed to asking for strategic advice about content), the 2-3 sentence cap does not apply and you never withhold the draft or ask a clarifying question first. Put the complete draft directly in "summary" as plain prose — full length, real line breaks where natural, written the way it should actually be posted or read aloud, still no markdown headings/bold/code-fences. Use whatever business context, active goal, and history you already have to make the concrete choices (angle, tone, specific claim) yourself, the way a senior ghostwriter would — missing a detail is never a reason to ask first; make the strongest reasonable call, and only if genuinely useful note the one assumption in a single trailing sentence after the draft. Return zero cards for a pure drafting request. If the founder asks for strategic advice ABOUT content (what to post about, when, why) rather than the draft itself, that is a normal strategy question — use the regular reasoning framework and card schema, not this exception. If a single message asks for both (e.g. "what should I post and can you draft it"), answer the strategy part briefly first, then the full draft, both inside "summary".` },
  { tag: "drafting", text: `DRAFTING CRAFT — a draft that reads like a template is a failed draft: open with a real hook (a specific claim, number, tension, or moment — never "Excited to share" / "In today's fast-paced world" / any line that could open literally any post). Pull at least one concrete, specific detail from the founder's actual business context, active goal, or prior conversation into the draft itself (a real number, a real product name, a real milestone) — zero specifics unique to this founder means the context wasn't used. Match the founder's own voice where the conversation shows one; otherwise the direct, plainspoken, no-corporate-hedge voice from above applies. Fit the format: a LinkedIn post reads different from a 30-second reel script (spoken-aloud rhythm, short beats) or presentation talking points (scannable, not prose) — write in the register the platform is actually read/heard in.` },
  { tag: "core", text: `The JSON always has this shape:
{ "summary": "3 to 5 sentence sharp executive insight, the thing they most need to hear right now", "isDraft": false, "confidence": "verified" or "exploratory", "confidenceNote": "brief note explaining whether the answer is grounded in verified precedents or should be treated as exploratory reasoning", "cards": [ { "type": "one of analysis, market, risk, roadmap, decision, precedent, funnel, solution", "role": "primary" or "supporting", "title": "Card title", "content": { } } ] }
Set "isDraft": true only for a DRAFTING MODE response as defined above (the summary contains an actual LinkedIn post / script / talking points the founder will copy, not advice about content) — this tells the system to preserve your line breaks instead of collapsing them into one paragraph. Leave it false for every normal strategy answer, including questions about what to post.` },
  { tag: "cards", text: `The content object shape depends on the card type.
For analysis cards the content is: { "points": [ { "label": "insight label", "value": "what you actually see here", "sentiment": "positive or negative or neutral" } ] }
For market cards the content is: { "tam": "$XB", "sam": "$XM", "som": "$XM", "growth": "X% CAGR", "competitors": [ "Company name — what they own and where they are weak" ], "whitespace": "The specific gap that exists right now that this business can own and why" }
For risk cards the content is: { "risks": [ { "name": "Risk name", "probability": 0-100, "impact": "High or Med or Low", "mitigation": "One specific action they can take this week to reduce this risk" } ] }
For roadmap cards the content is: { "horizon": "6 months or 24 months", "phases": [ { "period": "0-30 days", "title": "Phase name", "actions": [ "specific action" ], "metric": "The one number or outcome that tells you this phase succeeded" } ] }
For decision cards the content is: { "options": [ { "name": "Option name", "chosen": true or false, "reasoning": "2-3 sentences of real prose on why this option would or wouldn't work here", "scores": { "viability": 0-10, "speed": 0-10, "defensibility": 0-10, "capital_efficiency": 0-10 } } ], "recommendation": "Vera's clear call on which option and the single most important reason why" }
DECISION CARDS ARE SECONDARY: the call and why belongs in "summary" as prose FIRST — the card, if included, is supporting detail, never where the recommendation is first made or discovered. Each option's "reasoning" is the primary content — a real mechanism for why it wins or loses here, including options you're NOT picking; "scores" is optional/secondary and may be omitted. Thin or interchangeable reasoning across options is a failed card — rewrite it.
For precedent cards the content is: { "precedents": [ { "company": "Real company name", "year": "Year or range, e.g. 2008 or 2012-2015", "outcome": "succeeded, pivoted, collapsed, acquired", "lesson": "The specific causal lesson and how it applies here" } ] }
For funnel cards the content is: { "stages": [ { "title": "Stage name", "description": "One line" } ] } — titles ≤5 words, details ≤20 words.
For solution cards the content is: { "solutions": [ { "title": "Solution name", "description": "One line" } ] }` },
  { tag: "strategy", text: `A decision card needs a genuine second viable path — never manufacture one for a diagnostic "why is this stalling"/"what's broken" question, which has one mechanism, not a menu to score; use analysis/risk or no card instead. Choosing between 2+ distinct real paths → lead the summary (after the diagnosis) with the call and why it wins, in plain sentences, not a number. A percentage split on the founder's own stated options is optional color after that plain-language call, never an example from these instructions or a default 60/40. A HIGH-severity risk against one option → skew the language hard; genuinely close → say so. Skip for single-path or pure information questions.` },
  { tag: "strategy", text: `Binary yes/no questions → no "yes if/no if" hedging. Lead with an explicit verdict word ("Yes — not yet", "Wait", "Launch now"), then reasoning.` },
  { tag: "strategy", text: `MAKE THE BET: any substantive recommendation is a clear call ("do B, not A, because—"), not a menu of equally-open paths. Name the trade-off, then commit — but once a genuinely split comparison is done honestly, still give an opinionated read of what matters most in the next 30-60 days.` },
  { tag: "strategy", text: `Short/fragmentary queries ("shld i hire him or not") are complete strategic input — don't require full sentences before answering as a direct decision question.` },
  { tag: "strategy", text: `Cards support the prose, not replace it — 0 cards is correct for most diagnostic, definitional, or single-fact answers. ≥2 cards only for a broad request with genuinely multiple structured facets; ≤1 for a narrow follow-up. Direct questions ("what should I do") → tag the answering card "primary," everything else "supporting." Real company win/loss → precedent card, never prose-only. New business ideas → analysis + market. Risk/new-market entry → risk card. Genuine multi-path comparison → decision card, reasoning-first per the schema above. Roadmap → roadmap + risk card.` },
  { tag: "strategy", text: `Never include a card without genuine specific insight. State (C) still returns full substantive cards from category-level context — the narrowing question lives only in summary. State (B) returns one card with what you know.` },
  { tag: "core", text: `CRITICAL — EVERY CARD NEEDS A NON-EMPTY "title": never blank or omitted — the UI has no fallback and an untitled card renders with no label at all.` },
  { tag: "core", text: `CRITICAL — RETRIEVAL-GATED PRECEDENTS: only name companies present in the VERIFIED PRECEDENTS block below — never invent or recall from general knowledge. A precedent card must map directly to a verified record (same company, outcome, mechanism; paraphrase fine, added facts not). If the block is empty, no precedent card and no real company name anywhere in the response — speak only in general structural terms.` },
  { tag: "strategy", text: `Skip market cards when the question isn't about size/growth/competition/TAM-SAM-SOM. Roadmap/funnel descriptions: one scannable line each. Never put card content in the summary text.` },
  { tag: "strategy", text: `FORWARD-LOOKING FOUNDER MATH: when context has concrete numbers (capital, burn, team size, runway), use them. For stay-vs-pivot/build-vs-buy/hire-vs-wait calls, calculate implied runway (capital ÷ burn) against the realistic execution time of your recommendation, and state the math plainly ("14 months of runway against a 24-month moat-building timeline means raise again within 10 months or narrow the plan"). A strategy that ignores whether stated runway survives it is a hedge, not a verdict.` },
  { tag: "strategy", text: `UNDER LOW ADOPTION, REDUCE FRICTION BEFORE ADDING A FEATURE: don't default to "build the requested feature." First reason whether removing a step or integrating into a tool the founder already uses daily gets the same outcome — state that reasoning explicitly ("the fix isn't a new feature, it's cutting intake from 4 fields to 1"). Recommend a new feature only when friction-reduction genuinely wouldn't solve the diagnosed bottleneck.` },
  { tag: "strategy", text: `EVERY 30/60-DAY PLAN NEEDS NUMBERS: a time-bound but not metric-bound plan ("deploy the feature," "run the pilot") is a status update, not a plan. Include 1-3 concrete numeric/behavioral targets ("3→5 weekly active firms"). Governs the roadmap card's "metric" field and any plan language elsewhere.` },
  { tag: "strategy", text: `PRECEDENT BALANCE: for forward-looking questions, don't cite only failures — if the verified block has a success or successful pivot, cite at least one alongside any failures.` },
  { tag: "strategy", text: `TRIAL-TO-COMMITMENT, ACROSS ANY INDUSTRY: whenever a pilot/trial/sample stage is involved (SaaS, manufacturing, a school program, a subscription box, consulting scope), reason from the pattern that holds regardless of industry: open-ended trials with no end date or success measure drift instead of converting; a visible early win (not just a check-in) meaningfully improves conversion; the commit ask lands better once value is visible than raised beforehand. Scale "visible early win" to the actual business model, not a SaaS script.` },
  { tag: "ownHistory", text: `YOUR OWN VERIFIED HISTORY OUTRANKS EVERYTHING: if a "YOUR OWN VERIFIED HISTORY WITH THIS FOUNDER" block appears, it's this founder's own resolved ground truth — stronger than third-party precedents. When relevant, reason from it explicitly: what you recommended, what happened, how that confirms/revises/overturns your current answer. Never silently repeat advice that didn't work, and never contradict your own resolved history without acknowledging it. Never treat this block as a generic precedent.` },
  { tag: "openSession", text: `SAME-SESSION RECOMMENDATION CONSISTENCY: if an "OPEN RECOMMENDATIONS EARLIER THIS SESSION" block appears, it's a call you made minutes ago in this same live conversation, not yet resolved. If the current message proposes a different number or path for the same decision (a revised price, equity ask, valuation, or budget split), you are NOT free to independently re-derive a fresh "best" verdict on the new number as if the earlier one never happened. State plainly whether your recommendation is changing and the specific reason (new information that justifies it), or whether the founder is diverging from advice you already gave — either is fine, silently pretending the earlier recommendation doesn't exist is not. If the block genuinely doesn't relate to the current question, ignore it.` },
  { tag: "core", text: `CURRENT-TURN PRIMACY: history is for context, not a queue of pending actions — the CURRENT message alone decides what to answer and do this turn. Never resurface an old topic, draft, or deliverable just because it appeared a few turns back; a pivot to a new subject means follow the pivot.` },
  { tag: "core", text: `LITERAL REQUEST FIRST: answer the CURRENT message's literal request, not a nearby topic. Only if the message is genuinely readable two different ways (not just missing a detail — see gate above) → ask which, briefly. Otherwise answer directly, even if short.` },
  { tag: "strategy", text: `CHECK YOURSELF BEFORE RETURNING, WITHOUT SCORING YOURSELF: re-read your draft against the bars above — genuinely specific, chain traceable, fix matching the diagnosis, one first move rather than a bundle, a real number in the plan, an actual bet made. Fix what fails. A plain re-read, not a self-assigned numeric score (that would itself be fake precision). Then test the leading hypothesis against every OTHER fact the founder stated, not just the one that suggested it: a fact pointing elsewhere (churn doubling, while your call blames acquisition) must be addressed explicitly or allowed to change the call, never quietly filed as background. On diagnostic or high-stakes answers only (hypothesis-comparison card, meaningful spend, an irreversible call — skip for short factual or narrow follow-ups), add a final pass: state the strongest argument against your own leading conclusion using only the founder's stated facts, and revise if it would meaningfully change the recommendation. That argument must attack the HYPOTHESIS ("if churn explains the slowdown, acquisition saturation is irrelevant"), never merely propose a different action.` },
  { tag: "core", text: `Your entire response must be a single JSON object matching the shape above — nothing before it, nothing after it, no markdown fences.` },
];

// Every section, in order — the exact string that used to be the whole
// constant. Still what shrinkMessages measures against as a fallback, and
// what the prompt tests assert on.
const VENUS_SYSTEM_PROMPT = VENUS_PROMPT_SECTIONS.map((s) => s.text).join("\n\n");

// The final "core" paragraph, always present in every assembled variant and
// always last. shrinkMessages uses it to find where the instructions stop
// and caller-appended dynamic context begins — it can no longer rely on
// VENUS_SYSTEM_PROMPT.length now that the assembled prompt is shorter than
// the full one, since that would protect real dynamic content from being
// shrunk (and so keep re-sending an oversized payload on every retry).
export const VENUS_PROMPT_END_MARKER = VENUS_PROMPT_SECTIONS[VENUS_PROMPT_SECTIONS.length - 1].text;

/** Which apparatus this request actually needs. Defaults to the full stack. */
export type VenusResponseMode = "strategy" | "drafting" | "capability" | "open_ended";

export interface VenusPromptOptions {
  mode?: VenusResponseMode;
  /** Force the drafting rules in on top of the chosen mode. The classifier
   *  generalizes but is not infallible, and the cost of missing a drafting
   *  request (a full post capped at 3-5 sentences) is far worse than the
   *  cost of carrying the block unnecessarily — so ai.ts ORs in a keyword
   *  check here rather than trusting the classification alone. */
  includeDrafting?: boolean;
  /** Only sent when the matching block is actually in the prompt — a rule
   *  about how to read a block that isn't there is pure overhead. */
  hasOwnHistory?: boolean;
  hasOpenSession?: boolean;
}

export function buildVenusPrompt(options: VenusPromptOptions = {}): string {
  const { mode = "strategy", includeDrafting = false, hasOwnHistory = false, hasOpenSession = false } = options;

  const wanted = new Set<VenusPromptTag>(["core"]);
  if (mode === "strategy") wanted.add("strategy");
  if (mode === "drafting" || includeDrafting) wanted.add("drafting");
  if (mode === "capability") wanted.add("capability");
  if (mode === "open_ended") wanted.add("openEnded");
  // Card content schemas go to everything that can legitimately return a
  // card. A pure drafting request is the one mode that never should (see
  // DRAFTING MODE: "Return zero cards"), so it is the one mode that can
  // safely drop ~575 tokens of schema.
  if (mode !== "drafting") wanted.add("cards");
  if (hasOwnHistory) wanted.add("ownHistory");
  if (hasOpenSession) wanted.add("openSession");

  return VENUS_PROMPT_SECTIONS.filter((s) => wanted.has(s.tag))
    .map((s) => s.text)
    .join("\n\n");
}


export function extractJson(content: string): string {
  const stripped = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const jsonStart = stripped.indexOf("{");
  const jsonEnd = stripped.lastIndexOf("}");
  return jsonStart !== -1 && jsonEnd > jsonStart ? stripped.slice(jsonStart, jsonEnd + 1) : stripped;
}

/**
 * When max_tokens cuts the model off mid-response, the cut point is almost
 * always partway through the `cards` array — e.g. `..."cards": [ {...
 * complete card...}, {"type": "risk", "title": "Key Risk` with nothing after
 * it. extractJson()'s naive first-`{`/last-`}` slice on text like that either
 * fails to parse outright, or (worse) can accidentally land on a `}` that
 * closes an EARLIER, complete card while leaving a dangling partial one
 * later in the string un-terminated — again failing to parse. Previously the
 * only recovery path from here was the network repair-retry, which asks the
 * model to "complete" the JSON — and a model given a half-written card with
 * no clear ending will sometimes close it with empty/placeholder fields just
 * to produce syntactically valid JSON, which is exactly the hollow-card
 * failure mode this whole fix targets.
 *
 * This does the recovery locally and deterministically instead: walk the
 * `cards` array bracket-by-bracket, keep only cards whose opening `{` has a
 * matching closing `}` before the text runs out, and close the array there.
 * A truncated response becomes a shorter but fully valid array of complete
 * cards, with no invented content and no network round-trip. Returns null if
 * there's no recognizable `"cards": [` to repair (caller falls through to
 * the existing repair-retry).
 */
export function repairTruncatedCardsArray(content: string): string | null {
  const stripped = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const cardsKeyMatch = stripped.match(/"cards"\s*:\s*\[/);
  if (!cardsKeyMatch || typeof cardsKeyMatch.index !== "number") return null;

  const arrayStart = cardsKeyMatch.index + cardsKeyMatch[0].length;
  const completeCardSlices: string[] = [];
  let i = arrayStart;
  let sawAnyObjectStart = false;

  while (i < stripped.length) {
    // Skip whitespace/commas between array elements.
    while (i < stripped.length && /[\s,]/.test(stripped[i])) i++;
    if (stripped[i] === "]") break; // array closed cleanly, nothing to repair
    if (stripped[i] !== "{") break; // not a card object — stop, don't guess

    sawAnyObjectStart = true;
    const objStart = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;

    for (; i < stripped.length; i++) {
      const ch = stripped[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { i++; closed = true; break; }
      }
    }

    if (!closed) break; // this card was cut off mid-object — stop before it
    completeCardSlices.push(stripped.slice(objStart, i));
  }

  // Nothing usable recovered — let the caller fall through to repair-retry
  // rather than fabricating an empty cards array from a response that may
  // not actually be a truncated-cards case at all.
  if (!sawAnyObjectStart || completeCardSlices.length === 0) return null;

  const beforeCards = stripped.slice(0, cardsKeyMatch.index + cardsKeyMatch[0].length);
  const rebuilt = `${beforeCards}${completeCardSlices.join(",")}]}`;
  try {
    JSON.parse(rebuilt);
    return rebuilt;
  } catch {
    return null;
  }
}

/**
 * Repairs a specific malformation observed from Groq's gpt-oss models on
 * nested array-of-objects fields (e.g. a roadmap card's "phases", a decision
 * card's "options"): the model occasionally emits one stray extra "}" right
 * after an object's last value, before the "," or "]" that should follow —
 * e.g. `...,"metric":"School signs pilot agreement"}},{"period":...` where
 * only one "}" should close that phase object. It tends to repeat the same
 * mistake for every entry in the array (every phase, every option), not just
 * once. This is severe enough that Groq's own json_object mode rejects the
 * generation outright (400 json_validate_failed) rather than returning it as
 * a normal completion, so the content never reaches the usual
 * JSON.parse-failure repair path below — it has to be recovered from the
 * error body itself (see isJsonValidateFailedError).
 *
 * Deliberately narrow and deterministic, same philosophy as
 * repairTruncatedCardsArray above: each pass only ever REMOVES a single
 * stray "}" found near where JSON.parse actually reported the failure, then
 * re-parses to see if another one remains further along. Never invents or
 * alters real content — if a bounded number of passes still doesn't produce
 * valid JSON, gives up and returns null (caller retries a fresh generation
 * instead) rather than shipping a guess that isn't actually verified.
 */
export function attemptBraceRepair(content: string): string | null {
  let current = content;
  for (let pass = 0; pass < 8; pass++) {
    try {
      JSON.parse(current);
      return current; // fully valid — done (first pass: was already fine)
    } catch (e: any) {
      const match = /position (\d+)/.exec(e?.message ?? "");
      if (!match) return null;
      const pos = Number(match[1]);
      // Search backwards a short window from the reported failure position
      // for the nearest "}" — that's the stray brace in every observed case
      // — and strip exactly that one character before trying again.
      let fixed: string | null = null;
      for (let i = pos; i >= 0 && i > pos - 20; i--) {
        if (current[i] === "}") {
          fixed = current.slice(0, i) + current.slice(i + 1);
          break;
        }
      }
      if (fixed === null) return null;
      current = fixed;
    }
  }
  return null;
}

// The model returns valid JSON (enforced by Groq's json_object response mode),
// but "valid JSON" only guarantees the outer structure parses — it does not
// guarantee the *string values inside* are clean. In practice the model
// sometimes ignores the "summary is plain sentences only" instruction under
// load and stuffs a full markdown report (headings, bullet lists, even a
// fenced ```json ... ``` block reproducing the cards it already returned)
// into the summary string itself. That string then gets rendered verbatim by
// the frontend's line-by-line markdown-ish renderer, producing duplicated,
// broken-looking output. This is a last-resort safety net independent of
// prompt compliance: detect that duplication and cut summary back down to
// just the genuine leading prose, rather than de-formatting and keeping the
// whole duplicate report (which would just turn a broken structured mess into
// one long, still-duplicated wall of text).
function sanitizeSummaryText(summary: string, isDraft: boolean = false): string {
  let text = summary;

  // A bare title line like "# Venus AI Analysis" carries no real content —
  // drop it outright before looking for where the real prose ends, so it
  // doesn't get mistaken for the start of the summary's actual content.
  text = text.replace(/^\s*#{1,6}\s+.*\n+/, "");

  // A heading marker, a fenced code block, or a line that is just the word
  // "Card" (the model's own card-section label leaking into prose) all mean
  // the same thing: everything from that point onward is the model
  // re-rendering its own cards array as markdown, not summary prose. Cut
  // there rather than trying to preserve any of it — the real content
  // already exists properly structured in the cards array. Skipped in draft
  // mode: a drafted script legitimately has structure of its own (e.g. a
  // numbered list of talking points), and isDraft responses don't carry a
  // cards array worth deferring to anyway.
  if (!isDraft) {
    const structuralMarkerMatch = text.match(/\n\s*(#{1,6}\s|```|Card\s*$)/m);
    if (structuralMarkerMatch && typeof structuralMarkerMatch.index === "number") {
      text = text.slice(0, structuralMarkerMatch.index);
    }
  }

  // Defensive second pass in case a fence appeared without a preceding
  // newline (e.g. mid-sentence), or anything else slipped through above.
  text = text.replace(/```[\s\S]*$/g, "");

  if (isDraft) {
    // Draft mode: keep the model's real line/paragraph breaks (a LinkedIn
    // post or script is unusable flattened to one line) and keep list
    // markers and bold/italic if the model used them for the draft's own
    // structure. Only strip stray heading markers (frontend can't render
    // markdown headings) and collapse 3+ blank lines down to one for
    // tidiness — do NOT join lines with spaces the way the non-draft path
    // does below.
    text = text.replace(/^#{1,6}\s+/gm, "");
    text = text.split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text.length > 0 ? text : summary.trim();
  }

  // Strip any remaining inline markdown markers from the surviving prose.
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");

  // Collapse the now-ragged whitespace/newlines left behind by the removals
  // above into normal paragraph spacing.
  text = text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  text = text.replace(/\s{2,}/g, " ").trim();

  // Last-resort edge case: if every one of the above steps still left nothing
  // usable (e.g. the entire summary was structural markup with no prose at
  // all), fall back to the original text with fences/headings stripped
  // in place rather than shipping a blank summary to the UI.
  if (text.length < 10) {
    let fallback = summary
      .replace(/```[\s\S]*?```/g, "")
      .replace(/```[\s\S]*$/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1");
    fallback = fallback.split("\n").map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    text = fallback || text;
  }

  return text;
}

function sanitizeCardTitle(rawTitle: unknown, card: Record<string, unknown>, index: number): string {
  const title = typeof rawTitle === "string" ? rawTitle.replace(/^#{1,6}\s+/, "").trim() : "";
  if (title) return title;

  // Fallback only reached for a card that has ALREADY passed
  // cardHasRealContent below — i.e. it has genuine substance, it's just
  // missing a title string. Previously this same fallback was the ONLY
  // check applied, so a card with an empty title AND empty content (the
  // truncation case below) still made it to the client as a fully-labeled
  // "Section N" card with nothing inside — that's the bug. Now that hollow
  // cards are filtered out before this ever runs, this label only ever
  // wraps a card that genuinely has something to show.
  const type = typeof card.type === "string" && card.type ? card.type : null;
  if (type) {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} — Section ${index + 1}`;
  }
  return `Section ${index + 1}`;
}

// A non-empty string with real characters in it (not just whitespace/punctuation).
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Detects a card that is structurally present but semantically empty — the
 * signature shape of a card produced when the model's JSON got cut off
 * mid-array (max_tokens truncation) and either extractJson()'s brace-matching
 * or the repair-retry closed the array with a stub object just to make it
 * parse. These stubs are exactly what previously reached the client, got a
 * friendly fallback title from sanitizeCardTitle, and rendered as an
 * empty "SECTION N / SHOW" row that expands to nothing. A card is only kept
 * if it has at least one real, non-empty piece of content matching its
 * declared type — checked per-type because each type has a different shape,
 * and an empty `content: {}` (or content with only empty arrays/strings)
 * must be rejected regardless of type.
 */
function cardHasRealContent(card: Record<string, unknown>): boolean {
  const content = card.content;
  if (!content || typeof content !== "object") return false;
  const c = content as Record<string, unknown>;

  switch (card.type) {
    case "analysis":
      return Array.isArray(c.points) && c.points.some(
        (p: any) => p && typeof p === "object" && (hasText(p.label) || hasText(p.value)),
      );
    case "market":
      return (
        hasText(c.tam) || hasText(c.sam) || hasText(c.som) || hasText(c.growth) ||
        hasText(c.whitespace) ||
        (Array.isArray(c.competitors) && c.competitors.some((x: any) => hasText(x)))
      );
    case "risk":
      return Array.isArray(c.risks) && c.risks.some(
        (r: any) => r && typeof r === "object" && (hasText(r.name) || hasText(r.mitigation)),
      );
    case "roadmap":
      return Array.isArray(c.phases) && c.phases.some(
        (p: any) => p && typeof p === "object" && (hasText(p.title) || (Array.isArray(p.actions) && p.actions.some((a: any) => hasText(a)))),
      );
    case "decision":
      return (
        (Array.isArray(c.options) && c.options.some((o: any) => o && typeof o === "object" && hasText(o.name))) ||
        hasText(c.recommendation)
      );
    case "precedent":
      return Array.isArray(c.precedents) && c.precedents.some(
        (p: any) => p && typeof p === "object" && (hasText(p.company) || hasText(p.lesson)),
      );
    case "funnel":
      return Array.isArray(c.stages) && c.stages.some(
        (s: any) => s && typeof s === "object" && (hasText(s.title) || hasText(s.stage_title) || hasText(s.description) || hasText(s.stage_detail)),
      );
    case "solution":
      return Array.isArray(c.solutions) && c.solutions.some(
        (s: any) => s && typeof s === "object" && (hasText(s.title) || hasText(s.stage_title) || hasText(s.description) || hasText(s.stage_detail)),
      );
    default:
      // Unknown/free-form card type — accept as long as SOME key holds real
      // text or a non-empty array, rather than an object of empty values.
      return Object.values(c).some((v) => {
        if (hasText(v)) return true;
        if (Array.isArray(v)) return v.length > 0;
        return false;
      });
  }
}

/**
 * Cleans a parsed Venus response before it is sent to the client. Guarantees:
 *  - summary contains no markdown headings, fences, or list/bold markers that
 *    the frontend would otherwise render as broken duplicate structure
 *  - every remaining card has genuine content AND a non-empty, readable title
 *  - cards with no real content (the truncation/stub failure mode) are
 *    dropped entirely rather than shipped as an empty labeled section
 * This runs regardless of how well the model followed the prompt, so a
 * regression in model behavior (including a mid-response truncation) degrades
 * gracefully — fewer, fully-formed cards — instead of shipping hollow ones.
 */
export function sanitizeVenusResponse(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;

  const isDraft = parsed.isDraft === true;

  if (typeof parsed.summary === "string") {
    parsed.summary = sanitizeSummaryText(parsed.summary, isDraft);
  }

  // isDraft only exists to steer the sanitizer above (preserve line breaks
  // vs. collapse to executive-summary prose) — it's not part of the
  // established client-facing response shape, so don't ship it downstream
  // where nothing consumes it.
  delete parsed.isDraft;

  if (Array.isArray(parsed.cards)) {
    const droppedIndexes: number[] = [];
    const kept = parsed.cards.filter((card: any, index: number) => {
      const ok = card && typeof card === "object" && cardHasRealContent(card);
      if (!ok) droppedIndexes.push(index);
      return ok;
    });

    if (droppedIndexes.length > 0) {
      // Visible in server logs so a burst of these can be correlated with
      // truncation (finish_reason "length") logged upstream in
      // callGroqJSON, rather than silently vanishing either as an empty
      // card client-side or as a dropped card with no trace server-side.
      console.error(
        `[sanitizeVenusResponse] dropped ${droppedIndexes.length} empty/stub card(s) at index ${droppedIndexes.join(", ")} — likely truncated model output`,
      );
    }

    parsed.cards = kept.map((card: any, index: number) => ({
      ...card,
      title: sanitizeCardTitle(card.title, card, index),
    }));
  }

  return parsed;
}

interface GroqJsonParams {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
  // Only supported by openai/gpt-oss-20b and openai/gpt-oss-120b (the models
  // this file actually calls). Both are reasoning models: their hidden
  // "thinking" tokens are drawn from the SAME max_tokens budget as the
  // visible JSON answer. Left unset, Groq defaults reasoning_effort to
  // "medium", which scales up with how much the prompt asks of the model —
  // exactly what a long, descriptive founder query does. On a short prompt
  // the model barely has to think, so a 3000-token budget is plenty. On a
  // long, multi-part prompt the model can burn most or all of that budget on
  // reasoning alone, leaving too little (or nothing) for the actual JSON
  // object — which comes back truncated, fails JSON.parse, and previously
  // surfaced as the generic "Venus couldn't answer that" fallback. Defaulting
  // to "low" here (callers can still override) keeps reasoning bounded
  // regardless of prompt length, since the causal-chain structure Venus needs
  // is already spelled out explicitly in VENUS_SYSTEM_PROMPT rather than
  // relying on the model's own free-form chain-of-thought to find it.
  reasoning_effort?: "low" | "medium" | "high";
  // Defaults to true on Groq, which returns the reasoning trace in a separate
  // `message.reasoning` field. We never read that field, so there's no
  // reason to pay for generating and transmitting it — default it off.
  include_reasoning?: boolean;
}

/**
 * Calls Groq expecting a single JSON object back. If the response fails to parse
 * (truncated or malformed), retries once with a stricter "JSON only" instruction
 * and a higher token budget. Never silently drops a failure — logs it so it is
 * visible in server logs rather than swallowed.
 */
// Wraps a single Groq call with retry + backoff for transient failures (rate
// limits, timeouts, transient 5xx) AND for oversized-payload errors (413 /
// "too large" / "context length" messages from the provider). This is
// intentionally generic rather than tied to any one feature: whatever caused
// the request to grow too large this time — a long web search snippet today,
// a long conversation history or some other large input tomorrow — the fix is
// the same shape: shrink the largest content in the message list and retry,
// rather than erroring out or repeating the identical oversized request.
function isRetryableTransient(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  return status === 429 || (status >= 500 && status < 600) || err?.code === "ETIMEDOUT" || err?.code === "ECONNRESET";
}

// Groq's TPM limit is charged against prompt tokens PLUS the requested
// max_tokens (it reserves the full completion budget up front, whether or
// not the model actually uses it). A fixed max_tokens that doesn't account
// for how large THIS request's prompt already is can make the request
// oversized from the very first attempt — no amount of retrying at the same
// size fixes that, because shrinkMessages() (below) deliberately protects
// the static VENUS_SYSTEM_PROMPT from being trimmed, so on a short message
// with little/no dynamic content there is nothing left to shrink. The
// symptom is the same 413 repeating on every retry attempt.
//
// Migrated from openai/gpt-oss-120b (8000 TPM) to meta-llama/llama-4-scout-
// 17b-16e-instruct (30000 TPM free tier) on 2026-07-10, after an A/B test
// (scripts/src/venus-provider-ab-test.ts) showed gpt-oss-120b hitting real
// 429 rate-limit failures on 3/4 back-to-back test queries, while scout
// answered all 4 with comparable-or-better bottleneck-first reasoning and
// correctly grounded confidenceNote tiering. See that script's file header
// for the full comparison methodology.
//
// REVERTED back to openai/gpt-oss-120b on 2026-07-18: Groq deprecated
// meta-llama/llama-4-scout-17b-16e-instruct outright (announced 2026-06-17,
// effective on free/developer tier), and every call to it now returns a
// hard 404 model_not_found — not a rate limit, not recoverable by retrying.
// Groq's own deprecation notice recommends either openai/gpt-oss-120b or
// qwen/qwen3.6-27b as the replacement; gpt-oss-120b was chosen because it's
// the exact model this file ran on before the 2026-07-10 migration (known
// TPM ceiling, already has reasoning_effort support wired up below) rather
// than a new, unverified integration. This does mean giving back the 30K
// TPM headroom scout provided — the 429 risk the original migration was
// trying to avoid is real again, so watch server logs for 429s on this
// model and re-run the A/B script against qwen/qwen3.6-27b if they recur.
// Verify current values on Groq's /docs/rate-limits page before trusting
// these numbers long-term — these change over time and were last confirmed
// 2026-07-18.
//
// NOTE: the lighter-tier openai/gpt-oss-20b extraction/summarization routes
// (/ai/company-report, /ai/summarize-article, enrich_precedents.ts) were
// NOT part of either migration and stay on gpt-oss-20b unless a separate
// test justifies moving them. The TPM limit below is a PER-MODEL map, not a
// single constant — see GROQ_TPM_LIMIT_BY_MODEL a few lines down.
//
// A PAID-TIER MIGRATION WAS DRAFTED on 2026-07-18 assuming the Groq org
// would be upgraded to the Developer tier (see git history / PR for the
// original ~240,000 TPM version of this constant) — but the payment method
// was never actually added at console.groq.com -> Settings -> Billing, so
// the org is still on the FREE tier's real 8,000 TPM ceiling for both
// gpt-oss models. Running the 240,000 constant against a free-tier account
// made clampMaxTokensToTpmBudget think it had ~30x more headroom than it
// actually did, barely clamping max_tokens at all — which is why 413s kept
// happening even after the earlier VENUS_SYSTEM_PROMPT compression pass:
// the prompt shrink was real and worked, but this constant was silently
// undoing its effect by telling the pre-flight clamp there was no problem
// to solve. Reverted to the real free-tier number below.
//
// IF YOU DO UPGRADE TO THE PAID TIER LATER: don't just paste the old
// 240,000 back in. Log into console.groq.com's Limits page (organization-
// level, not per-key) and read the actual current number for each model —
// Groq's quoted 250,000-300,000 range is a general figure, not a per-org
// guarantee, and per-model numbers can differ (see the note on gpt-oss-20b
// vs gpt-oss-120b below).
export const TPM_SAFETY_MARGIN = 0.85;
// Floor for max_tokens: below this, JSON responses (multi-card schema) don't
// reliably complete before truncating, so there's no point shrinking further
// — better to surface a clear failure than a guaranteed-truncated response.
export const MIN_USABLE_MAX_TOKENS = 1200;

// Rough, provider-agnostic token estimate (~4 chars/token for English
// prose). Exactness doesn't matter here, only staying safely under the
// ceiling does — this is a budgeting heuristic, not a billing calculation.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Locked behind this flag rather than a direct value swap — a prior session
// (see .agents/memory/groq-scout-deprecation-2026-07.md) shipped the paid-tier
// numbers directly into GROQ_TPM_LIMIT_BY_MODEL assuming the org had already
// been upgraded, but no payment method had actually been added at
// console.groq.com/settings/billing — so the free-tier account kept 413ing
// while this file thought it had 30x more headroom than it really did. Do
// NOT flip this to "true" (env var GROQ_PAID_TIER=true) until BOTH: (1) a
// payment method is actually live at console.groq.com/settings/billing, and
// (2) the real per-model TPM number has been read off that account's own
// Limits page and pasted into PAID_TIER_TPM_LIMIT_BY_MODEL below, replacing
// the placeholder estimate.
const GROQ_PAID_TIER = process.env.GROQ_PAID_TIER === "true";

const FREE_TIER_TPM_LIMIT_BY_MODEL: Record<string, number> = {
  // Deprecated by Groq (2026-06-17 notice, enforced as of 2026-07-18) — hard
  // 404 model_not_found on every call now, not a rate limit. Kept in this
  // map (rather than deleted) only so a stray call site that still names it
  // fails with a clamped, informative request instead of an undefined TPM
  // lookup — but every real call site in this codebase has been migrated
  // off it back to openai/gpt-oss-120b below.
  "meta-llama/llama-4-scout-17b-16e-instruct": 30000,
  // REAL free-tier limit, confirmed against console.groq.com/docs/rate-limits
  // on 2026-07-18.
  "openai/gpt-oss-20b": 8000,
  "openai/gpt-oss-120b": 8000, // current production model for all Venus
  // reasoning routes as of the 2026-07-18 revert — see migration comment
  // above for why.
};

// PLACEHOLDER estimate only, inactive unless GROQ_PAID_TIER=true — Groq
// quotes a general 250,000-300,000 TPM range for the Developer tier, 240,000
// stays conservatively under that. TODO once the tier is actually purchased:
// log into console.groq.com's Limits page (organization-level, not per-key)
// and overwrite these two with the real confirmed numbers before relying on
// this in production.
const PAID_TIER_TPM_LIMIT_BY_MODEL: Record<string, number> = {
  "meta-llama/llama-4-scout-17b-16e-instruct": 30000,
  "openai/gpt-oss-20b": 240000,
  "openai/gpt-oss-120b": 240000,
};

const GROQ_TPM_LIMIT_BY_MODEL = GROQ_PAID_TIER ? PAID_TIER_TPM_LIMIT_BY_MODEL : FREE_TIER_TPM_LIMIT_BY_MODEL;
const DEFAULT_GROQ_TPM_LIMIT = 8000; // conservative fallback for any model
// string not in the map above (e.g. a new model added later without
// updating this file) — always the free-tier figure regardless of
// GROQ_PAID_TIER: an unrecognized model name is exactly the case where
// over-clamping is the safe default, not the case to extend paid-tier trust to.
export function tpmLimitForModel(model: string): number {
  return GROQ_TPM_LIMIT_BY_MODEL[model] ?? DEFAULT_GROQ_TPM_LIMIT;
}

// Sizes max_tokens DOWN to fit the TPM ceiling given this request's actual
// prompt size, before the request is ever sent. This is what actually fixes
// the "even the shortest message fails" case: previously max_tokens was a
// fixed value chosen for the largest expected response, so a short prompt
// with a big fixed max_tokens could still exceed the ceiling on attempt 1
// with zero dynamic content available to shrink. Never raises max_tokens —
// only clamps it down when the prompt is big enough to require it.
function clampMaxTokensToTpmBudget(params: GroqJsonParams, label: string): GroqJsonParams {
  const tpmLimit = tpmLimitForModel(params.model);
  const promptTokens = params.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const budget = Math.floor(tpmLimit * TPM_SAFETY_MARGIN);
  const available = budget - promptTokens;
  if (available >= params.max_tokens) return params;

  const clamped = Math.max(MIN_USABLE_MAX_TOKENS, available);
  console.error(
    `[callGroqJSON] "${label}" (model=${params.model}) — prompt is ~${promptTokens} est. tokens, clamping max_tokens from ${params.max_tokens} to ${clamped} to fit the ${tpmLimit} TPM ceiling (est., ${Math.round(TPM_SAFETY_MARGIN * 100)}% safety margin)`,
  );
  return { ...params, max_tokens: clamped };
}

function isOversizedPayload(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 413) return true;
  const msg = (err?.message || err?.error?.message || "").toLowerCase();
  return /too large|too long|context length|maximum context|payload/i.test(msg);
}

// Shrinks the largest message(s) in the array to a target fraction of their
// current length, preserving the system prompt's fixed structural
// instructions (VENUS_PROMPT itself) intact, and trimming from the end of
// long content blocks. Generic over message role/content — doesn't know or
// care what put the extra length there.
//
// IMPORTANT: the system message is NOT a fixed-size block. ai/analyze (and
// other routes) build it by concatenating VENUS_PROMPT with a large amount of
// genuinely dynamic, per-request content appended after it — business
// context, conversation history, verified-precedent blocks, web search
// results, this founder's own past decisions. That appended content, not
// VENUS_PROMPT, is almost always the actual source of payload bloat, and it
// scales with conversation length exactly like user/assistant history does.
// A previous version of this function protected the ENTIRE system message
// from shrinking on the theory that the system message was just the static
// prompt — that assumption is no longer true, and protecting the wrong ~half
// of the payload meant retries kept resending an oversized request and
// getting the same 413 back every time (see the "payload too large" retry
// loop this was written to fix).
//
// The fix: only protect the first VENUS_PROMPT.length characters of any
// system message (the actual fixed instructions, guaranteed to contain the
// "json" keyword Groq's json_object mode requires). Everything after that
// prefix — the dynamic context appended by the caller — is shrunk exactly
// like any other message's content.
// Every non-system message is now kept WHOLE or DROPPED WHOLE — never
// partially truncated. The previous version sliced every message
// (including the founder's own current turn) to keepFraction of its own
// length, compounding across retries (0.5 -> 0.25 after 2) — production
// logs on 2026-07-22 showed exactly that firing on a real request right
// before it "completed", meaning the model most likely answered from a
// current message and conversation history each cut to roughly a quarter
// of their real content, mid-sentence. A model handed a gutted, half
// -sentence context fills the gap with a generic, self-consistent-but-
// ungrounded answer — which is exactly the fabricated-scenario, ignored-
// turn, stale-answer failures reported from testing that day. Losing whole
// old turns is an honest gap the model can reason around; corrupting
// recent/current ones is not.
// How far back from the requested cut point we'll hunt for a clean break
// before giving up and cutting where we were told to. Generous enough to
// find a paragraph or sentence end in normal prose, small enough that it
// can't discard a meaningful share of an already-shrunken tail.
const SAFE_BOUNDARY_LOOKBACK = 400;

const TRUNCATION_NOTICE = "\n\n[Context truncated here to fit the request size limit — some supporting material above was omitted. Do not treat any figure or name near this point as complete, and do not infer what was cut.]";

/**
 * Cuts `text` to at most `maxLen` characters, at a boundary that doesn't
 * land in the middle of something meaningful.
 *
 * WHY THIS ISN'T JUST `.slice(0, maxLen)`, which is what it used to be: the
 * dynamic tail being cut here is the grounding material — web search
 * snippets, the precedent block, business context, memory. A raw character
 * cut lands wherever it lands, which routinely means mid-number
 * ("...revenue was $4" from "$4.2M") or mid-name ("...acquired by Sales").
 * The model has no way to know it received a mutilated figure, so it reasons
 * from it as though it were whole — a fabricated fact produced by our own
 * truncation rather than by the model.
 *
 * That matters far more than it sounds, because on the free tier shrinking
 * is not the rare path: VENUS_SYSTEM_PROMPT alone is ~6,807 estimated tokens
 * against a ~6,800 budget, so nearly every broad request gets here.
 *
 * Preference order is paragraph break, then sentence end, then any
 * whitespace. An explicit notice is appended so the model is told content
 * was removed instead of silently inferring across the seam.
 */
export function sliceAtSafeBoundary(text: string, maxLen: number): string {
  if (maxLen >= text.length) return text;
  if (maxLen <= 0) return TRUNCATION_NOTICE.trimStart();

  const window = text.slice(0, maxLen);
  const floor = Math.max(0, maxLen - SAFE_BOUNDARY_LOOKBACK);

  const candidates = [
    window.lastIndexOf("\n\n"),
    // Sentence end followed by whitespace — `. ` / `.\n` / `?\n` etc.
    (() => {
      const m = window.match(/[.!?](?=\s)(?![\s\S]*[.!?](?=\s))/);
      return m?.index != null ? m.index + 1 : -1;
    })(),
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
  ];

  const cut = candidates.find((i) => i > floor);
  return `${text.slice(0, cut != null && cut > 0 ? cut : maxLen).trimEnd()}${TRUNCATION_NOTICE}`;
}

export function shrinkMessages(messages: GroqJsonParams["messages"], keepFraction: number): GroqJsonParams["messages"] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1; // the current turn — never touched, whatever role it has

  const withSystemShrunk = messages.map((m, idx) => {
    if (m.role === "system") {
      // Where the assembled instructions stop and caller-appended dynamic
      // context begins. Found by the end marker rather than by
      // VENUS_SYSTEM_PROMPT.length, which is now the length of the FULL
      // prompt and therefore longer than most assembled variants — using it
      // would protect several thousand characters of real dynamic context
      // from being shrunk, so a retry would resend a payload just as
      // oversized as the one that just failed. Falls back to the old
      // measurement if the marker somehow isn't present.
      const markerIdx = m.content.indexOf(VENUS_PROMPT_END_MARKER);
      const protectedLen =
        markerIdx >= 0
          ? markerIdx + VENUS_PROMPT_END_MARKER.length
          : Math.min(VENUS_SYSTEM_PROMPT.length, m.content.length);
      const head = m.content.slice(0, protectedLen);
      const dynamicTail = m.content.slice(protectedLen);
      if (dynamicTail.length === 0) return m;
      const targetLen = Math.floor(dynamicTail.length * keepFraction);
      if (targetLen >= dynamicTail.length) return m;
      return { ...m, content: head + sliceAtSafeBoundary(dynamicTail, targetLen) };
    }
    return m; // no other message's content is ever sliced — see the drop pass below
  });

  // History turns (every non-system message except the current/last one)
  // are dropped OLDEST-first, whole, until roughly keepFraction of them
  // remain, instead of each being proportionally truncated.
  const systemIdx = withSystemShrunk.findIndex((m) => m.role === "system");
  const historyIdxs = withSystemShrunk.map((_, i) => i).filter((i) => i !== systemIdx && i !== lastIdx);
  const keepCount = Math.max(0, Math.floor(historyIdxs.length * keepFraction));
  const dropIdxs = new Set(historyIdxs.slice(0, historyIdxs.length - keepCount));

  return withSystemShrunk.filter((_, i) => !dropIdxs.has(i));
}

// Last-resort structural guarantee: if, for any reason (a future prompt
// rewrite, a different shrink strategy, a system message that itself somehow
// lacks the word "json"), the outgoing messages array doesn't contain the
// word "json" anywhere, Groq's API will hard-reject the request when
// response_format is json_object — turning what should be a normal retry
// into an opaque 400. This is cheap insurance against that entire failure
// class: append a minimal, harmless system message guaranteeing the
// requirement is met, without altering any of the model's real instructions.
function ensureJsonWordPresent(messages: GroqJsonParams["messages"]): GroqJsonParams["messages"] {
  const hasJsonWord = messages.some((m) => /json/i.test(m.content));
  if (hasJsonWord) return messages;
  return [...messages, { role: "system", content: "Respond with a single valid json object as instructed above." }];
}

export function isContentPolicyRefusal(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const code = (err?.code || err?.error?.code || "").toLowerCase();
  const msg = (err?.message || err?.error?.message || "").toLowerCase();
  return status === 400 && (code.includes("content") || code.includes("policy") || /content.?polic|flagged|refus/i.test(msg));
}

// Groq's json_object mode validates the model's own generation and rejects
// it as a 400 rather than returning it as a normal completion when the JSON
// is malformed enough (see attemptBraceRepair above for the specific pattern
// observed). The model's attempted output still exists — Groq includes it as
// "failed_generation" in the error body — it's just never handed back as a
// completion, so it has to be pulled out of the error itself.
function isJsonValidateFailedError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const code = (err?.code || err?.error?.code || "").toLowerCase();
  return status === 400 && code === "json_validate_failed";
}

function extractFailedGeneration(err: any): string | null {
  const gen = err?.failed_generation ?? err?.error?.failed_generation;
  return typeof gen === "string" ? gen : null;
}

// Groq's 429s cover two very different situations: a per-minute burst limit
// (worth the existing 300ms-1.2s in-request retry below) and a daily/quota
// exhaustion (the message embeds a wait measured in minutes-to-hours — e.g.
// "Please try again in 58m31.728s" — which no amount of retrying within this
// same request can fix). Reads Groq's own stated wait time out of the error
// body rather than guessing a fixed number, since it varies with how far
// over budget the account is at the moment of the call.
function parseRetryAfterMs(err: any): number | null {
  const msg: string = err?.error?.message || err?.message || "";
  const match = msg.match(/try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return totalMs > 0 ? totalMs : null;
}

// Once the parsed wait exceeds this, an in-request retry (max backoff is
// 1200ms on the last attempt) has zero chance of succeeding — fail fast
// with an honest message instead of burning 2 pointless retries plus their
// backoff delay on a request the founder is actively waiting on.
const QUOTA_RETRY_FAIL_FAST_THRESHOLD_MS = 5000;

export function isQuotaExhaustedError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status !== 429) return false;
  const retryAfterMs = parseRetryAfterMs(err);
  return retryAfterMs !== null && retryAfterMs > QUOTA_RETRY_FAIL_FAST_THRESHOLD_MS;
}

// Exposed so callers (ai.ts's catch block) can surface the real wait time
// to the founder instead of a generic "try again" — only meaningful once
// isQuotaExhaustedError(err) is true; returns null otherwise/on parse failure.
export function quotaRetryAfterMs(err: any): number | null {
  return parseRetryAfterMs(err);
}

async function createWithRetry(groq: Groq, params: GroqJsonParams, label: string, attempts = 3) {
  let lastErr: unknown;
  let currentParams = params;
  for (let i = 0; i < attempts; i++) {
    try {
      return await groq.chat.completions.create(currentParams);
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      // A content-policy refusal from the provider is never retryable — retrying
      // or shrinking the payload won't change the provider's answer.
      if (isContentPolicyRefusal(err)) throw err;
      // Same logic: a daily/quota 429 (see isQuotaExhaustedError) has a
      // real wait measured in minutes-to-hours — retrying inside this
      // request cannot possibly succeed, so fail fast instead of spending
      // 2 more attempts' worth of latency on a request that's already lost.
      if (isQuotaExhaustedError(err)) {
        console.error(`[callGroqJSON] "${label}" — quota exhausted (status=429), retry-after=${parseRetryAfterMs(err)}ms, failing fast instead of retrying`);
        throw err;
      }
      if (isOversizedPayload(err)) {
        // Halve message sizes each retry — generic degradation, not a fix
        // targeted at any specific source of bloat. System messages are
        // never shrunk (see shrinkMessages), and ensureJsonWordPresent is a
        // final structural guarantee that the request can never end up
        // missing the word "json" that Groq's json_object response format
        // requires, regardless of what shrinking does to the other messages.
        //
        // max_tokens is ALSO shrunk here, not just message content. The
        // static system prompt is deliberately protected from shrinking, so
        // on a short message there may be little or no dynamic content left
        // to trim — in that case max_tokens is the only remaining lever, and
        // leaving it fixed meant every retry re-sent an equally oversized
        // request and got the same 413 back (see clampMaxTokensToTpmBudget
        // above for the pre-flight version of this same fix).
        const shrunkMaxTokens = Math.max(MIN_USABLE_MAX_TOKENS, Math.floor(currentParams.max_tokens * 0.6));
        console.error(`[callGroqJSON] "${label}" — payload too large (status=${status}), shrinking messages (max_tokens ${currentParams.max_tokens} -> ${shrunkMaxTokens}) and retrying (${i + 1}/${attempts - 1})`);
        currentParams = {
          ...currentParams,
          max_tokens: shrunkMaxTokens,
          messages: ensureJsonWordPresent(shrinkMessages(currentParams.messages, 0.5)),
        };
        if (i === attempts - 1) throw err;
        continue;
      }
      if (isJsonValidateFailedError(err)) {
        const failedGeneration = extractFailedGeneration(err);
        const repaired = failedGeneration ? attemptBraceRepair(failedGeneration) : null;
        if (repaired) {
          console.error(`[callGroqJSON] "${label}" — Groq rejected its own generation as invalid JSON (json_validate_failed), repaired a stray brace locally and recovered it without a retry`);
          // Synthesize a completion-shaped result so the normal parse path in
          // callGroqJSON handles it exactly like any other successful call —
          // only the two fields it actually reads (content, finish_reason)
          // need to exist.
          return { choices: [{ message: { content: repaired }, finish_reason: "stop" }] } as any;
        }
        console.error(`[callGroqJSON] "${label}" — Groq rejected its own generation as invalid JSON (json_validate_failed) and local repair failed, retrying a fresh generation (${i + 1}/${attempts - 1})`);
        if (i === attempts - 1) throw err;
        continue; // same params — a fresh sample, not a shrink; this isn't a size problem
      }
      if (!isRetryableTransient(err) || i === attempts - 1) throw err;
      const delayMs = 300 * Math.pow(2, i); // 300ms, 600ms, 1200ms
      console.error(`[callGroqJSON] "${label}" — transient error (status=${status}), retry ${i + 1}/${attempts - 1} after ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function callGroqJSON(
  groq: Groq,
  params: GroqJsonParams,
  label: string,
): Promise<{ parsed: any | null; raw: string; errorType?: "parse" | "transient" }> {
  // Every caller gets Groq's JSON mode by default so the provider enforces
  // valid JSON at the API level (never markdown fences, never prose before/
  // after the object) rather than relying purely on the system prompt asking
  // nicely for it. New call sites inherit this automatically — nobody has to
  // remember to add it. Callers can still override by passing their own
  // response_format if a future route genuinely needs raw text back.
  // reasoning_effort and include_reasoning are ONLY supported by Groq's
  // gpt-oss family (see GroqJsonParams comments above) — llama-4-scout and
  // any other non-gpt-oss model reject them outright with a 400
  // "not supported with this model" error (this is exactly what happened in
  // production immediately after the 2026-07-10 model migration to
  // llama-4-scout — every /ai/analyze call failed until this was fixed).
  // Only inject these defaults when the target model actually supports
  // them; a caller explicitly passing either field is still respected via
  // ...params below regardless of model, since that's an intentional
  // override, not this function's guess.
  const supportsReasoningEffort = params.model.startsWith("openai/gpt-oss");
  const paramsWithJsonMode: GroqJsonParams = clampMaxTokensToTpmBudget(
    {
      response_format: { type: "json_object" },
      // See GroqJsonParams comments: bounds hidden reasoning-token usage so it
      // can't crowd out the visible JSON answer on long/descriptive prompts.
      // Placed before ...params so a caller that genuinely wants more reasoning
      // can still override either field explicitly.
      ...(supportsReasoningEffort
        ? { reasoning_effort: "low" as const, include_reasoning: false }
        : {}),
      ...params,
    },
    label,
  );
  const completion = await createWithRetry(groq, paramsWithJsonMode, label);
  const raw = completion.choices[0]?.message?.content || "";
  const finishReason = completion.choices[0]?.finish_reason;

  if (finishReason === "length") {
    // The model hit max_tokens before it finished writing — reasoning ate
    // into the budget, or the answer itself (many cards for a broad/complex
    // query) is just long. Whatever the cause, `raw` below is guaranteed to
    // be incomplete JSON, so log this distinctly from a genuine malformed-
    // JSON response — it tells us immediately, from server logs alone,
    // whether a given failure needs a bigger max_tokens rather than a prompt
    // fix.
    console.error(`[callGroqJSON] "${label}" — response truncated by max_tokens (budget=${paramsWithJsonMode.max_tokens}, raw_len=${raw.length}), will retry with a larger budget`);
  }

  const candidate = extractJson(raw);

  try {
    return { parsed: JSON.parse(candidate), raw };
  } catch {
    // Before spending a network round-trip asking the model to "complete"
    // truncated JSON (which risks a hollow-card completion — see
    // repairTruncatedCardsArray's comment above), try the deterministic
    // local repair first. This only ever removes an incomplete trailing
    // card; it never invents content, so it's strictly safer than the retry
    // below, and it avoids an extra network round-trip entirely.
    const locallyRepaired = repairTruncatedCardsArray(raw);
    if (locallyRepaired) {
      try {
        const parsed = JSON.parse(locallyRepaired);
        console.error(`[callGroqJSON] "${label}" — initial response truncated (finishReason=${finishReason}), recovered ${Array.isArray(parsed?.cards) ? parsed.cards.length : 0} complete card(s) locally without a retry`);
        return { parsed, raw };
      } catch {
        // fall through to network repair-retry below
      }
    }

    console.error(`[callGroqJSON] "${label}" — initial response failed to parse (len=${raw.length}, finishReason=${finishReason}), retrying with stricter prompt + higher token budget`);

    const retryMessages: GroqJsonParams["messages"] = [
      ...params.messages,
      {
        role: "user",
        content: "Your previous response was not valid JSON or was truncated. Repair it now and return ONLY the complete, valid JSON object — no markdown fences, no preamble, no commentary, nothing before or after the JSON.",
      },
    ];

    try {
      // Previously capped at 4000 regardless of the caller's own max_tokens —
      // for callers already passing max_tokens >= 2000 (as ai/analyze and
      // ai/idea-review do), doubling and then clamping to 4000 could hand the
      // repair attempt LESS headroom than a genuinely long response needs,
      // guaranteeing a second truncation. Raise the ceiling well above any
      // current caller's base budget so doubling is actually doubling.
      const retryMaxTokens = Math.min(params.max_tokens * 2, 12000);
      // This retry adds a whole extra "please repair this" message on top of
      // the original prompt AND doubles max_tokens — exactly the combination
      // that can turn a request that only barely fit under the TPM ceiling
      // into one that doesn't. Route it through the same clamp used for the
      // initial call rather than trusting retryMaxTokens directly.
      const retryParams = clampMaxTokensToTpmBudget(
        { ...paramsWithJsonMode, messages: retryMessages, max_tokens: retryMaxTokens },
        `${label} (repair retry)`,
      );
      const retryCompletion = await groq.chat.completions.create(retryParams);
      const raw2 = retryCompletion.choices[0]?.message?.content || "";
      const candidate2 = extractJson(raw2);
      try {
        return { parsed: JSON.parse(candidate2), raw: raw2 };
      } catch {
        // Same deterministic salvage as the first attempt — a second
        // truncation on the doubled-budget retry is rare but not
        // impossible on a very long response, and this is still strictly
        // safer than shipping null/error here when some real cards did
        // come back complete.
        const locallyRepaired2 = repairTruncatedCardsArray(raw2);
        if (locallyRepaired2) {
          try {
            const parsed = JSON.parse(locallyRepaired2);
            console.error(`[callGroqJSON] "${label}" — retry also truncated, recovered ${Array.isArray(parsed?.cards) ? parsed.cards.length : 0} complete card(s) locally`);
            return { parsed, raw: raw2 };
          } catch {
            // fall through to giving up below
          }
        }
        console.error(`[callGroqJSON] "${label}" — retry ALSO failed to parse (len=${raw2.length}). Giving up, surfacing raw content to caller. raw2_head=${raw2.slice(0, 300)}`);
        return { parsed: null, raw: raw2, errorType: "parse" };
      }
    } catch (retryErr) {
      console.error(`[callGroqJSON] "${label}" — retry call itself threw`, retryErr);
      return { parsed: null, raw, errorType: "transient" };
    }
  }
}

// ---- Inference always runs on the server's own credential ----
//
// This used to take a sessionId, look up settings.groqApiKey for that user,
// and prefer it over the server's key — the "bring your own API key" path.
// That whole path is gone: the column, the /settings/groq-key endpoints that
// wrote it, and the `x-groq-api-key` header override that bypassed even that.
//
// Removing it closes three things at once. A user-supplied key was a real
// credential stored in plaintext in the settings table. The header variant
// was settable by any caller on routes that read it, making the server's
// outbound LLM calls steerable from outside. And "which key is this request
// using?" stopped being answerable per-request, which is the sort of ambiguity
// that hides billing and abuse problems.
//
// The client is built once and reused. Groq's SDK holds no per-request state,
// so a module-level instance is safe and avoids re-constructing it on every
// call. Returns null (rather than throwing) when GROQ_API_KEY is unset, since
// every caller already handles a null client by degrading to a non-LLM
// fallback response.
let cachedGroqClient: Groq | null | undefined;

export function getGroqClient(): Groq | null {
  if (cachedGroqClient === undefined) {
    const apiKey = process.env.GROQ_API_KEY;
    cachedGroqClient = apiKey ? new Groq({ apiKey }) : null;
  }
  return cachedGroqClient;
}

export const VENUS_PROMPT = VENUS_SYSTEM_PROMPT;

// Injected into the system prompt only for "moderate" confidence tier queries —
// real precedents exist but are few and/or from an adjacent/analogous sector
// rather than an exact match. The model must still never fabricate beyond the
// given precedents, but must be transparent that this is a lower-confidence,
// exploratory read rather than a fully-grounded verdict.
export const MODERATE_TIER_PRECEDENT_NOTE = `

IMPORTANT — LIMITED PRECEDENT MODE (moderate confidence): The VERIFIED PRECEDENTS below are real, but there are few of them and/or they come from an adjacent or analogous sector/decision type rather than an exact match to this query. You must still reason ONLY from these real precedents — never invent a company, outcome, or causal mechanism not present in the block below, and explicitly name which precedent(s) you are drawing from and why they are still relevant even though the match is imperfect. Do NOT put any caveat about confidence, precedent coverage, or data limitations as the first sentence of the summary field, and do not use the phrase "exploratory signal" or similar hedging language anywhere in the summary — the summary must open directly with the causal bottleneck and recommendation, exactly as it would for a fully-grounded answer. The lower-confidence signal is communicated separately through the confidenceNote field, not by prefacing or softening the actual answer — a founder reading the summary should get a real, direct, confident-sounding recommendation, not a hedged one, even when the precedent match is imperfect.`;

// ---- Shared grounding guards ----
//
// MOVED HERE FROM ai.ts's /ai/analyze handler, where it was a local const.
// Being local is what made it a divergence bug: /ai/idea-review — a second
// full LLM pipeline in the same file, answering the same kind of question
// with the same VENUS_PROMPT — never had a grounding guard at all, and
// neither did the company-autopsy route. Every hardening pass applied to
// /ai/analyze quietly did not apply to them. The guard is a property of
// "Vera answering anything", not of one route, so it lives with the prompt
// it guards and every call site imports the same string.
//
// NAMED-ENTITY GROUNDING GUARD: separate from the precedent-card rule in
// VENUS_SYSTEM_PROMPT (which only ever policed *company* names against the
// curated dataset). Nothing previously stopped the model from inventing
// OTHER specific named real-world entities — school names, addresses, exact
// enrollment figures, named people, named products — when it had no real
// source for them. That gap, combined with a since-fixed bug where
// webSearch() silently returned zero results for EVERY query (a broken
// DuckDuckGo result-link regex — see websearch.ts), produced exactly this
// failure: asked for real Cambridge-curriculum schools in Mumbai, the model
// confidently invented plausible-sounding school names with fabricated
// student counts and neighborhoods. Reasoning, opinions and strategic
// advice should stay direct and concrete — that's still encouraged — but a
// SPECIFIC factual claim about a real-world named entity must come from an
// actual source, never be invented to fill a gap.
export const NAMED_ENTITY_GUARD = `GROUNDING OF NAMED ENTITIES (applies to every answer): a specific factual claim about a real-world named entity — the name of a school/company/product/person/place, an exact statistic, an address, a date, a current price — must come from an actual source available to you right now: the web search results in this prompt, the verified precedent dataset, or something the user themselves told you. If you do not have a real source for the specific names or figures the question needs, say so plainly and briefly, then offer what you CAN do (search for it, or reason about how to evaluate options once they have the list). Never fill the gap with plausible-sounding invented specifics — a confident wrong name is far worse than an honest "I don't have verified data on that." This governs concrete factual claims ONLY. Your strategic reasoning, causal analysis, opinions, and recommendations are NOT affected by this rule and must stay as direct, specific, and opinionated as always — hedging your advice is not the goal here, and "I'm not sure" is never an acceptable substitute for judgment on a question that calls for judgment.`;

// Grounding rules specific to a factual/lookup question (see
// queryClassifier.ts). Kept separate from NAMED_ENTITY_GUARD so a
// consultation question never picks up "cite your sources" framing that
// would make ordinary strategic advice read like a research report.
const FACTUAL_LOOKUP_GROUNDING = `\n\nTHIS IS A FACTUAL LOOKUP: the founder is asking for real-world information, not (only) judgment. Ground every specific fact in the WEB SEARCH RESULTS provided, and attribute naturally in the prose where it matters ("per <source>…"). If the search results don't actually contain what was asked for, say exactly that — name what you did and didn't find — rather than filling the gap from memory. If sources disagree, say they disagree instead of silently picking one. Do not present a fact from your own training data as if it were retrieved and current.`;

/**
 * The grounding block every Vera answer carries. `isFactualLookup` adds the
 * source-attribution rules on top; it never removes the named-entity guard,
 * which applies unconditionally.
 */
export function buildGroundingInstructions(isFactualLookup: boolean): string {
  return `${NAMED_ENTITY_GUARD}${isFactualLookup ? FACTUAL_LOOKUP_GROUNDING : ""}`;
}

// Feeds shadow-mode fact-conflict detection (see factConflicts.ts and
// ai.ts's [factConflict] logging) — a founder can contradict themselves
// within one conversation ("churn is up but so is our NPS") in a way no
// amount of precedent-vs-precedent checking can catch, since that lives in
// freeform text the model reads once and never re-exposes as structured
// data. This is that structured exposure: nothing more.
//
// Measured cost (chars/4, same heuristic estimateTokens uses elsewhere in
// this file): ~660 characters ≈ 165 tokens, added to the system prompt on
// every request this is appended to. Real against the 8,000 TPM ceiling —
// this is why ai.ts only appends it for non-narrow queries, and why the
// resulting extractedFacts field is logged in shadow mode rather than
// shipped to the client until real production cost/signal data justifies
// widening it (see the plan this implements).
//
// Scoped to "current message AND the conversation history above" — not
// just the current message — so a metric mentioned two turns ago and a
// conflicting one mentioned just now still gets caught, at effectively
// zero extra token cost (that history is already injected into the prompt
// for any non-narrow query; this only asks the model to also look there).
// Deliberately does NOT try to catch obliquely-phrased facts ("we're
// losing fewer people than before" instead of "churn is down") — inferring
// intent here would violate the same "never infer, only what's stated"
// principle VENUS_SYSTEM_PROMPT already enforces, and risks turning this
// into a false-positive machine. That's a known, accepted recall gap for
// this pass; revisit only if shadow-mode logs show it's a real, frequent miss.
export const EXTRACTED_FACTS_INSTRUCTION = `

EXTRACTED FACTS (mechanical bookkeeping, not part of your reasoning voice): scanning the founder's current message AND the conversation history above, if any of these tracked metrics — churn, nps, growth, retention, headcount, revenue, cac, ltv — was given an explicit directional change (up, down, or flat), list each as one entry in the "extractedFacts" array: { "metric": "one of the tracked names above", "direction": "up|down|flat" }. Only include a metric a message actually stated a direction for — never infer, never include a metric nobody mentioned. Empty array if none apply. This field is separate from and never restates the summary/cards content.`;

// Shadow-mode only (see evidenceConvergence.ts and ai.ts's [convergence]
// logging) — asks the model for competing hypotheses with FACT/INFERENCE/
// ASSUMPTION-tagged evidence, contradictions between them, and the single
// highest-value missing unknown. Deliberately does NOT ask for a confidence
// level, tier, or recommendation — those are computed downstream in code
// from these structured fields, never asserted by the model (see
// computeConvergence in evidenceConvergence.ts).
//
// Everything nests under one "evidenceConvergence" wrapper key rather than
// flat top-level fields — a flat top-level "contradictions" field would
// collide with the field computeConfidence already ships live on every
// response today (precedent-vs-precedent disagreement, unrelated to this).
//
// precedent_ids MUST be the bracketed [Precedent N] position number(s) from
// the VERIFIED PRECEDENTS block, not a company name or any other
// identifier — this is what lets evidenceConvergence.ts cross-check a
// hypothesis's own claimed precedent_match_count/outcome_consistency
// against what its FACT-tagged citations actually resolve to, instead of
// trusting those two numbers as self-reported (the same trust problem the
// whole confidence-computed-in-code design exists to close, just moved one
// field deeper if left unchecked).
//
// Measured cost (chars/4, same heuristic used elsewhere in this file):
// 2,351 characters ≈ 588 tokens, added to the system prompt on every
// request this is appended to. Real against the 8,000 TPM ceiling — ai.ts
// only appends this for non-narrow queries, same gate as
// EXTRACTED_FACTS_INSTRUCTION, and both together add up to real fixed
// overhead worth watching in the [callGroqJSON] clamp logs during the
// shadow period (see the plan this implements).
export const EVIDENCE_CONVERGENCE_INSTRUCTION = `

EVIDENCE CONVERGENCE (mechanical fields, shadow-mode — populate faithfully, never omit, and never state a confidence level, tier, or recommendation anywhere in this block; that is computed separately downstream, not something you decide): in addition to the JSON shape above, include one wrapper field "evidenceConvergence": { "hypotheses": [...], "contradictions": [...] | "none_identified", "key_missing_info": "..." }.

"hypotheses": 2 to 4 genuinely distinct explanations for the founder's question, even if one seems obviously stronger. Each hypothesis: { "id": "h1" (short stable id), "explanation": "one sentence, a mechanism not a stance", "evidence": [ { "claim": "specific claim used in this hypothesis's reasoning", "tag": "FACT" | "INFERENCE" | "ASSUMPTION", "precedent_ids": ["1"] } ], "precedent_match_count": integer, "outcome_consistency": 0 to 1 }.

Tag every evidence claim at the moment you write it: FACT only if directly attributable to a specific VERIFIED PRECEDENTS entry's decision context, decision taken, causal mechanism, or outcome — when tagging FACT, "precedent_ids" MUST be the bracketed number(s) of that entry as shown, e.g. "1" for [Precedent 1], never a company name or any other identifier. If no VERIFIED PRECEDENTS block appears anywhere in this prompt, every claim is necessarily INFERENCE or ASSUMPTION — never tag anything FACT, and leave precedent_ids empty, since there is nothing to cite. INFERENCE is a pattern reasonably drawn from precedent without a direct citation — leave precedent_ids empty or omit it. ASSUMPTION has no precedent backing at all. Never invent a precedent match or outcome to make a hypothesis look better supported — if you cannot find real precedent for a claim, tag it ASSUMPTION rather than upgrading it. "precedent_match_count" and "outcome_consistency" are your own estimate for reference only — they are not authoritative and are not what determines confidence.

"contradictions": diff every hypothesis against every other one; the literal string "none_identified" if there truly are none — never omit this field. Each real contradiction: { "hypothesis_a_id", "hypothesis_b_id", "description" }.

"key_missing_info": one sentence naming the single unknown that would most change which hypothesis is favored — mandatory even when one hypothesis is clearly strongest.`;

export function buildFallbackVenusResponse(message: string): object {
  return {
    summary: "Vera is not configured. Please add your Groq API key in Settings to unlock full intelligence. Here's a placeholder response based on your query.",
    confidence: "exploratory",
    confidenceNote: "The response is only a placeholder because the Groq API key is not configured.",
    cards: [
      {
        type: "analysis",
        title: "Action Required",
        content: {
          points: [
            { label: "Status", value: "Groq API key not configured", sentiment: "negative" },
            { label: "Fix", value: "Go to Settings → Groq API Key and paste your key", sentiment: "neutral" },
            { label: "Get Key", value: "Visit console.groq.com to create a free API key", sentiment: "positive" },
          ],
        },
      },
    ],
  };
}

// This is the true last resort — only reached after retries AND payload
// shrinking have both been exhausted (see createWithRetry) or a genuinely
// non-retryable error occurred. Intentionally short and plain: no confidence
// badge, no diagnostic card, no "status/fix" breakdown. Those made a rare,
// real failure look like a rich structured answer, which is misleading. This
// is the one honest "something didn't work" message in the whole system —
// everything else should be handled by retrying, shrinking, or falling
// through to general/web-search-grounded reasoning instead of erroring.
// Rounds a millisecond duration into a founder-readable phrase ("58
// minutes", "2h 5m") — only ever built from Groq's own stated wait time
// (see quotaRetryAfterMs), never a hardcoded guess.
function formatWaitDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes === 1) return "1 minute";
  if (totalMinutes < 60) return `${totalMinutes} minutes`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours} hour${hours > 1 ? "s" : ""}` : `${hours}h ${mins}m`;
}

export function buildTransientErrorResponse(message: string, kind?: "policy" | "quota", retryAfterMs?: number | null): object {
  const summary = kind === "policy"
    ? "Sorry, Vera can't answer that. Please try a different question."
    : kind === "quota"
      ? `Vera's hit today's usage limit.${retryAfterMs ? ` Try again in about ${formatWaitDuration(retryAfterMs)}.` : " Please try again shortly."}`
      : "Sorry, Vera couldn't answer that right now. Please try again or ask something else.";
  return {
    summary,
    isError: true,
    errorType: "transient",
    cards: [],
  };
}

export function buildRippleFallback(eventTitle: string): object {
  return {
    analysis: `Causal analysis of "${eventTitle}" requires a configured Groq API key. Add your key in Settings to unlock AI-powered ripple analysis.`,
    causalChain: ["Event occurs", "First-order effects propagate", "Second-order consequences emerge", "Market equilibrium shifts"],
    affectedSectors: ["Technology", "Finance", "Markets"],
  };
}

export function buildAutopsyFallback(companyName: string): object {
  return {
    rootCause: `Deep autopsy of ${companyName} requires a configured Groq API key. Add your key in Settings.`,
    timeline: "Timeline analysis unavailable without AI configuration.",
    lessonsLearned: ["Configure your Groq API key to unlock full autopsy analysis", "Visit Settings to add your key"],
    causalChain: ["Root cause", "Compounding factors", "Critical failure point", "Collapse"],
    analogy: null,
  };
}