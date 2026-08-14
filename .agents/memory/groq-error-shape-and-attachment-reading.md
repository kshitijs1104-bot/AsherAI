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

**The vision model id is resolved at runtime** from `groq.models.list()`
(override with `GROQ_VISION_MODEL`), never hardcoded — see
`groq-scout-deprecation-2026-07.md` for why a pinned id is a time bomb in this
codebase specifically. If no vision model is available the code degrades to
the honest "I can't read that" branch, never to a guess.
