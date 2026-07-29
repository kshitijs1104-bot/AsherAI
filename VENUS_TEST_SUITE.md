# Venus AI — Manual Test Suite

Run this after ANY change to `groq.ts`, `ai.ts`, or `Venus.tsx`. It's built from
real bugs found in production testing, not hypotheticals — every row here is
something that actually broke once. Takes ~10 minutes.

I can't call the live Groq API from my sandbox, so I can't run this myself —
you run it in the actual app, paste me the transcript for anything that fails,
and that transcript IS the bug report (see "Standard Debug Prompt" at the
bottom). No more screenshot-by-screenshot back and forth.

**Rule of thumb:** if a change touches the system prompt or the analyze route,
run all of Section 1–4. If it's a pure UI/CSS change, Section 5 is enough. If
a change touches `max_tokens`, retry logic, or anything in `groq.ts`'s
request-sizing, run Section 8.

---

## Section 1 — Context Gate (cold start, brand NEW chat, zero prior context)

| # | Prompt | Pass criteria |
|---|--------|----------------|
| 1.1 | `What's my biggest risk right now and how do I fix it?` | Asks for context (industry/stage/customer). Does NOT answer with real cards. |
| 1.2 | `Find 3 failed companies most similar to mine and why they failed` | Asks for context. |
| 1.3 | `What's the biggest threat to our burn rate and how do I fix it?` | Asks for context. |
| 1.4 | `Run an investor-fit analysis — which VCs are most likely to fund us?` | Asks for context. |
| 1.5 (negative control) | `What is a SWOT analysis?` | Answers directly, does NOT ask for context. If this one starts gating too, the gate is over-firing. |

If 1.1–1.4 fail (Venus answers without asking) → check `requiresContext()` in
`ai.ts` — the keyword list or personal-reference regex likely missed the new
phrasing. Don't just add the one word that failed; ask whether the underlying
signal (a personal "my/our/mine" reference) was even checked.

## Section 2 — Context Persistence (same chat, after giving context once)

1. Paste a context block, e.g.:
   > We're building a B2B SaaS for [industry]. [Stage], raised [$X], burning
   > [$X]/month, team of [N], targeting [customer].
2. Re-ask any prompt from Section 1.

**Pass:** does NOT re-ask for context, uses the actual numbers/industry you gave.
**Fail:** re-asks "what industry are you in" after you already said it.

## Section 2b — Corrections (the founder pushing back mid-conversation)

Every row here is a real message from a live transcript where Vera answered
`Got it — noted: "<your own words>". What would you like help with?` instead of
answering, or re-issued the recommendation the founder had just rejected.

Run this as ONE continuous conversation, in order. Ask any question that gets a
real recommendation with a number in it first (e.g. "we're losing customers to
Zepto-like services — where should I spend my testing budget?"), then:

| # | Prompt | Pass criteria |
|---|--------|----------------|
| 2b.1 | `no im saying 25% wld be losing out on too much profit` | Answers the profit objection. Never "Got it — noted". |
| 2b.2 | `im correcting u` | Re-examines the previous answer. Does NOT restate it with an agreeable "Yes, ..." opener. |
| 2b.3 | `not testing budget giving 25% as dscount is unreasonable` | Recognises it read "25%" as a budget share when the founder meant a discount, says so in one clause, answers the discount question. |
| 2b.4 | `ans my question` | Answers. Never asks what they'd like help with. |
| 2b.5 | `no, we're B2B not a marketplace` | Answers using the corrected framing AND the correction sticks (ask a follow-up — it should not still think you're a marketplace). |
| 2b.6 (negative control) | Start a NEW chat, paste `We operate a subscription platform for gyms, 450 paying customers, $35,000 MRR` | Still acknowledges the context and asks what you need. If this starts answering with cards, the reply guard is over-firing. |

**Root cause if 2b.1/2b.3 fail:** `isPureContextStatement` in `ai.ts` swallowed the
message. Check `BUSINESS_METRICS_SIGNAL` hasn't regained a loose numeric pattern
(a bare `\d+%` was the original culprit), and that the answer-withholding gate
guard still consults `looksLikeReplyToPriorTurn` / `correctsPriorAnswer`.

**Root cause if 2b.2 fails:** the message reached the model but
`correctionInstruction` wasn't in the prompt — check `classification.correctsPriorAnswer`
in the `[queryClassifier]` log line for that turn.

Server-side confirmation for any row: a `[turnIntent] routed=answer` log line
means the guard caught it; `[queryClassifier] corrects=true` means the model
agreed it was a correction.

Unit coverage for the guard itself:

```bash
cd artifacts/api-server && npx tsx --test src/lib/turnIntent.test.mjs
```

## Section 2c — Length constraints (must not hijack ordinary answers)

`parseLengthConstraint` runs on EVERY message, not just drafting requests. It
used to match any `<n> words|characters` anywhere and default a bare number to
*exact*, so an ordinary question could have its whole answer forced to an
absurd length — plus 3 wasted revision calls trying to hit it.

| # | Prompt | Pass criteria |
|---|--------|----------------|
| 2c.1 | `we only have 50 characters left in the product title field, what should we do` | A normal, full-length answer. NOT 50 characters. |
| 2c.2 | `our top 3 words customers use are speed, price, trust — how do I use that` | A normal answer. NOT 3 words. |
| 2c.3 | `draft a 100 word linkedin post about our launch` | Roughly 100 words (±10). Should not visibly pad or amputate to hit exactly 100. |
| 2c.4 | `keep it under 280 characters` (after any draft request) | 280 characters or fewer. |
| 2c.5 | `summarise that in exactly 50 words` | Exactly 50 words, or an explicit note saying what it actually landed on. |

Unit coverage: `npx tsx --test src/lib/lengthConstraint.test.mjs`

## Section 2d — Attachments (never analyse a file Vera can't read)

| # | Action | Pass criteria |
|---|--------|----------------|
| 2d.1 | Attach a PNG screenshot, ask `what's wrong with these numbers?` | Says plainly it can't read that file type yet and asks you to paste the numbers. It must NOT describe or analyse the image. |
| 2d.2 | Attach a `.csv` of real numbers, ask the same | Actually answers, using values from the file. |
| 2d.3 | Attach a PDF, ask `summarise this` | Declines to summarise, offers the paste-the-text path. No invented summary. |

If 2d.1 or 2d.3 produce an analysis, the attachment block isn't reaching the
prompt — check `buildAttachmentBlock` in `lib/attachmentContext.ts` and that
the composer still emits the `[Attached file: name]` marker it parses.

## Section 2e — Dossier (company file + monthly wrap)

Requires the `company_dossiers` migration (`pnpm --filter @workspace/db run push`).
Reached from the sidebar entry under Workflows, or `/vera/dossier`.

| # | Action | Pass criteria |
|---|--------|----------------|
| 2e.1 | Paste a few paragraphs about a business, hit "Build my file" | A structured file appears. Every field it shows must trace to something you actually wrote — nothing invented. |
| 2e.2 | Check the "Not known yet" list | Names the things your paste genuinely didn't cover. |
| 2e.3 | Read the gap questions | They reference YOUR business specifics, not a generic form. Each has a "why". None asks about something you already stated. |
| 2e.4 | Answer one, then go ask Vera a question in chat | The answer is used. It reached the prompt via the company-file block. |
| 2e.5 | Upload a text-based PDF instead of pasting | File builds from the PDF's contents. |
| 2e.6 | Upload a scanned/photographed PDF | Clear error saying there's no text layer and to send a digital version. Never a file built from guesses. |
| 2e.7 | Open "Monthly wrap" on a quiet month | Says the month was quiet. No fabricated highlights, no page of zeroes dressed up. |
| 2e.8 | Open it on an active month | Real counts, month-over-month comparison, and a narrative containing no number that isn't in the stats above it. |

**The one thing to watch:** every number on the wrap is computed in code and only
the narrative is model-written. If the narrative ever states a figure that isn't in
the stat tiles, that's the bug — check `NARRATIVE_SYSTEM_PROMPT` in `lib/monthlyWrap.ts`.

Unit coverage: `npx tsx --test src/lib/documentText.test.mjs`

## Section 3 — Founder Math (needs context from Section 2 first)

Ask a stay-vs-pivot / survival-shaped question, e.g.:
> Realistically, do we have a shot against [competitor], or should we pivot?

**Pass criteria (all of these, not just one):**
- Explicitly computes or references runway (capital ÷ burn), using the actual
  numbers you gave — not a generic "you should build a moat."
- States a real verdict word — pivot, stay, wait, raise-first — not just a
  strategy category.
- If it recommends a strategy, it says whether your stated runway can survive
  executing it (e.g. "24 months to build this moat against your 14 months of
  runway means...").

**Fail example (this exact failure happened before the fix):** "You cannot
compete on price, so build a defensible moat" with no numbers anywhere. That's
a hedge wearing a verdict's clothes.

## Section 4 — Precedent Integrity

Ask: `What should our strategy be going forward?` (or similar forward-looking ask).

**Pass:** if the precedent dataset has any success/pivot outcome relevant to
the question, at least one appears alongside any failures — not an all-failure
graveyard list.
**Also check:** every named company is one you can verify actually appeared in
that response's precedent card — no company should appear in the summary prose
that isn't backed by a precedent card.

## Section 5 — Rendering / UI Integrity

Visual-only checks, no need for context setup:

- [ ] No raw `` ```json `` code fence ever appears inside a rendered chat bubble.
- [ ] No literal `[object Object]` appears anywhere on screen.
- [ ] Long analysis-card labels (full sentences, not short tags) never crush
      the value text into single-word-per-line vertical stacking.
- [ ] The quick-jump pill nav at the top of a long response does NOT float
      over/obscure the card text as you scroll through that message.
- [ ] On a brand-new chat with an empty message list, all 5 example prompts
      are visible and reachable — either they fit on screen, or the container
      scrolls to reveal the rest (no clipped-with-no-way-to-scroll state).

## Section 6 — Specificity ("mentor," not "template generator")

Give a context block with at least one hard constraint (small team, no sales
channel, skeptical customer base, etc.), then ask for a 90-day priority.

**Pass:** the recommendation explicitly traces back to the constraint you
named ("because you have 1 dev and no sales team, your bottleneck is X, so
priority is Y") AND includes at least one concrete number/tactic/artifact —
an actual price, a named channel, a specific script — not just a category
name like "develop a pricing strategy."
**Fail:** the same answer would make sense for literally any startup in that
industry, constraint or no constraint.

## Section 7 — Risk Probability Justification

Any response with a risk card:

**Pass:** every probability number (e.g. "70%") is paired with a reason tied
to something specific — a stated fact or a named precedent — in the same
sentence or the adjacent mitigation field.
**Fail:** a round, unexplained number (70%, 80%) that reads like it would be
identical regardless of what you told Venus.

---

## Section 8 — TPM Budget Guard (413 "payload too large")

Only needs re-running if you touch `max_tokens`, `clampMaxTokensToTpmBudget`,
`createWithRetry`, or `shrinkMessages` in `groq.ts`, or add a new call site to
`callGroqJSON`.

Background: the free-tier Groq TPM limit (8000) is charged against prompt
tokens PLUS the requested `max_tokens`, and `VENUS_SYSTEM_PROMPT` alone is
~4,900 tokens — so on `/ai/analyze` there's genuinely very little headroom
left for the actual response, even on a short message. This section exists
because the previous version of this bug looked identical on every message
length ("shrinking messages and retrying" 3x, then a 413) since the retry
loop shrunk dynamic message content but never `max_tokens`, and the protected
system prompt left nothing to shrink on a short message.

| # | Prompt | Pass criteria |
|---|--------|----------------|
| 8.1 | Brand new chat, send the shortest possible message: `hi` or `?` | No 413 in server logs. You get either a real response or the "ask one clarifying question" fallback — never a hard error. |
| 8.2 | Same, but a message that will miss the verified-precedent dataset (triggers the live web-search block, the largest dynamic addition to the prompt) — e.g. ask about an obscure/made-up product name | No 413. Check server logs for a `clamping max_tokens from 6000 to N` line — confirms the pre-flight clamp fired instead of relying on a failed request to discover the problem. |
| 8.3 | A long follow-up in a chat with 5+ prior turns (exercises `sessionHistory` growth) | No 413. If response looks unusually short/thin, check logs for `response truncated by max_tokens` — that's the clamp doing its job (protecting the TPM budget) but at a quality cost worth knowing about, not a bug. |

**Fail:** any 413 in server logs, on any message length. **Also fail:** the
same 413 repeating 2-3 times with an unchanged token count in the log line —
that means a retry is happening without `max_tokens` actually shrinking.

**Known tradeoff, don't "fix" this by silently raising the clamp back up:**
because the system prompt already consumes the majority of the 8000 TPM
budget, the clamp frequently caps `max_tokens` down near its 1,200-token
floor on the free tier — expect shorter, sometimes single-card responses
under load rather than the full multi-card format. That's the honest
consequence of an ~5,000-token system prompt against an 8,000 TPM ceiling,
not a regression in this fix. The actual fix for response *quality* (as
opposed to the crash) is either trimming `VENUS_SYSTEM_PROMPT` materially or
moving off the Groq free tier — see the comment above `GROQ_TPM_LIMIT` in
`groq.ts`.

## Standard Debug Prompt (reuse this instead of describing bugs from scratch)

When something looks wrong, paste me this filled in — it's everything I need
in one shot instead of a back-and-forth:

```
BUG REPORT
1. Exact prompt sent: "..."
2. Full Venus response (copy-paste, not paraphrase): ...
3. New chat or continuing one with prior context already given?
4. What I expected instead:
5. Which test-suite section does this map to (1–7 above), if any:
6. Screenshot attached? (for anything visual)
```

This makes every bug reproducible against a specific section of this suite
instead of a one-off patch, and tells me whether to look at `requiresContext`,
the system prompt, the rendering code, or the model/API layer — the four
places bugs have actually come from so far.
