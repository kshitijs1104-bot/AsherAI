---
name: Vera correction-capture and eval harness
description: Where the self-growing regression suite lives, how to run it, and why it is generated rather than hand-written — read before adding any "known bad query" test list.
---

Vera has a closed feedback loop as of 2026-07-26. Two halves, built together:

**Capture (F6):** `response_feedback` table (`lib/db/src/schema/response_feedback.ts`) + `artifacts/api-server/src/lib/responseFeedback.ts`. Every time a founder tells Vera its previous answer was wrong, the full triple (original question → Vera's answer → the correction) is persisted with a coarse `issueClass` (`fabricated_entity` | `misread_intent` | `wrong_topic` | `other`). Detection rides along on the `queryClassifier` call that already runs for every message, so it costs no extra round-trip. **Requires `pnpm --filter @workspace/db push` to create the table** — until that runs, `recordCorrection` logs and degrades to a no-op (by design, never breaks a chat).

**Eval (F7):** `scripts/src/vera-eval-corpus.ts` (generator) + `scripts/src/vera-eval.ts` (runner). Run with `GROQ_API_KEY=... pnpm --filter @workspace/scripts eval -- --count 60 --out baseline.json`, compare later runs with `--baseline baseline.json`. Reports **failure-class rates** and **tokens together, per tier** — never one without the other.

**Why:** The bug that motivated this (invented Mumbai schools, "skls" read as "skill lab") would not have appeared on any hand-written test list, because nobody predicts the failure they haven't had yet. Same reasoning that ruled out a dictionary of ambiguous terms: a curated list always trails real usage. The corpus is therefore generated across a **dimension grid** (domain × entity type × locale × abbreviation style × intent = 23,040 points), and real captured corrections are folded in as the highest-value cases, since those are recorded facts about how Vera *did* fail rather than guesses about how it might.

**How to apply:** Before adding any fixed list of test queries, or any per-term/per-topic special case, use these instead — add a *dimension value* to `DIMENSIONS` (expands coverage multiplicatively) rather than a case. When judging any change to prompt size, reasoning depth, or retrieval thresholds, run the eval and report quality **and** token cost together; a change that improves one while silently degrading the other is not a win. See also [[retrieval-gating-lexical-overlap]] for a fix that looked correct on the failing query alone and regressed every other query shape.
