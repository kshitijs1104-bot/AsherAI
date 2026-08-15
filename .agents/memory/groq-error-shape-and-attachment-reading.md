---
name: Groq error shape, and how attachments get read
description: groq-sdk nests its error body one level deeper than the predicates in groq.ts assumed, which silently disabled every json_validate_failed recovery path; plus the ingest pipeline that now reads images and files.
---

## groq-sdk puts the error details one level deeper than you think

`APIError.error` is the **response body**, and that body is itself
`{ "error": { message, type, code, failed_generation } }`. So on a real Groq
error:

- `err.code` → **undefined**
- `err.error.code` → **undefined**
- `err.error.error.code` → the actual code

`isJsonValidateFailedError`, `isContentPolicyRefusal` and
`extractFailedGeneration` in `lib/groq.ts` all read the first two forms, so
they always returned false/null against production errors. Everything gated on
them inside `createWithRetry` — the local brace repair, the fresh-sample
retry, the prose salvage — was **unreachable dead code**, and a
`json_validate_failed` 400 propagated out of `/ai/analyze` as a generic
transient error instead.

**Why it stayed invisible:** the failure looks exactly like "the model just
didn't answer". Nothing logs "I did not recognise this error", so a predicate
that never matches produces silence, not a symptom.

**How to apply:** every field read off a Groq error goes through
`groqErrorField(err, field)` in `lib/groq.ts`, which checks the flat, nested
and body-level positions. Add new predicates there, never with a fresh
`err?.error?.x` chain. `src/lib/attachmentReading.test.mjs` asserts against the
real nested shape — keep that test if the SDK is upgraded.

**Related:** `callGroqJSON` now takes `{ salvageProseAs }`. When the model
answers in plain prose because the prompt genuinely called for a plain
sentence (a refusal, a clarification), JSON mode rejects it; rather than lose
a good answer to a schema technicality, the prose is wrapped into the named
field. `/ai/analyze` passes `"summary"`.

## Attachments are read once at upload, not per turn

`lib/attachmentIngest.ts` is the single entry point (`ensureIngest`):

- **Images** → `lib/visionExtract.ts`, a Groq vision call that TRANSCRIBES
  only (no analysis — that belongs in the main Venus call, which has the
  business context and grounding guards).
- **Documents** → `lib/documentText.ts` (unchanged: PDF/DOCX/XLSX/text).
- Result is cached in a **sidecar file** `uploads/<storagePath>.vera.json`,
  not a DB column, so it needs no migration and dies with the file.
  Retryable failures (a 429 on the vision call) are deliberately NOT cached —
  caching one would declare a founder's screenshot permanently unreadable.
- On success, `distilDocumentFacts` writes up to 5 durable facts to
  `company_facts` with `sourceType: "document"`, which every later prompt
  reads back through `getActiveCompanyFacts`.

## You cannot infer vision support from a model name

Groq's current vision model is **`qwen/qwen3.6-27b`** (verified against
console.groq.com/docs/vision, 2026-08-15). The llama-4 models are gone.

The first version of `visionExtract.ts` resolved the model by matching
`/vision|llama-4|vl|omni/` against the account's model list — which matches
`qwen/qwen3.6-27b` **not at all**, so it shipped, every image resolved to "no
vision model available", and the symptom was indistinguishable from the
feature never having been built. `/models` returns only
`{ id, created, object, owned_by }` — there is **no capability field** — so a
maintained `KNOWN_VISION_MODELS` list is the only thing that can be correct.
Name-matching survives only as a logged last-resort guess.

Qwen is a thinking model: pass `reasoning_effort: "none"` (Groq's documented
off switch) or it burns the token budget reasoning about a transcription task
and returns nothing, which looks exactly like an unreadable image.

## The free tier cannot fit a document and the strategy prompt

Measured, not estimated:

| | tokens |
|---|---|
| Free-tier TPM ceiling (both models) | 8,000 (200K/day) |
| Usable after the 0.85 safety margin | 6,800 |
| `buildVenusPrompt({mode:"strategy"})` | **5,849** |
| `buildVenusPrompt({mode:"document"})` (core+cards) | ~1,750 |

So a document-bearing request in strategy mode has **negative** room for the
document. The original fixed 4,000/8,000-char attachment budget put those
requests ~8,700 tokens against an 8,000 ceiling: over on attempt 1, still over
after `createWithRetry`'s shrink passes (which protect the static prompt), and
out the other side as the generic "Vera couldn't answer that right now". The
constants were harmless *before* files were genuinely readable, because the
budget was never actually spent — making reading work is what turned a latent
overspend into a live one.

Two mechanisms now prevent it, both in `ai.ts`:
- `fileBudgetFor()` sizes the attachment block from the **measured** remaining
  headroom (`buildAttachmentBlock` takes a `charBudget`), so the ceiling can't
  be blown. Under the floor it says "read it, no room to include it" —
  a different, honest message from "couldn't read it".
- When the file won't fit at all, the prompt drops to `mode: "document"`
  (core+cards) and the freed ~4,100 tokens go to the file: ~5,600 characters
  fit on the free tier. **This never fires once `GROQ_PAID_TIER=true`** —
  the paid tier has room for both, with no code change.

**If attachments regress, read `[attachmentBudget]` and `[promptMode]` in the
server logs first** — they print the file budget, the chosen mode and the tier.
