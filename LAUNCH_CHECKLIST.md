# Before Vera is published to anyone outside the team

Everything on this list is a known gap, not a suspicion. Each one was found
while building the privacy policy and consent gate on 2026-08-15, and each was
left undone deliberately — because it needs a decision you have to make, or a
migration that should not be bolted on at the end of an unrelated change.

Nothing here is blocking development. All of it is blocking publication.

---

## 1. Name the parent company — BLOCKING

**Where:** `artifacts/vera-nexus/src/pages/legal/privacyPolicy.tsx`,
`POLICY_META.parentEntity`.

Currently an empty string, which renders as "Vera's parent company" everywhere
the owner is named — including section 13, the clause that says the software,
prompts and design cannot be copied. An intellectual-property clause that does
not name its owner is the one clause you least want vague, and it is also the
entity a user is agreeing *with* in section 1.

Set the constant once and every mention updates. No other edit needed.

## 2. Watch the contact address

**Where:** same file, `POLICY_META.contactEmail`, now `kshitij.s1104@gmail.com`.

Section 9 and section 13 point people at this address for every right the policy
grants: access, correction, deletion, objection, complaints. Someone has to
actually read it, within the 30 days the policy commits to. Move it to a
role-based address (not a personal one) before volume makes that unworkable.

Also confirm `POLICY_META.jurisdiction` — currently `India`, which sets the
governing law in section 17 and the transfer language in section 10.

## 3. Record consent server-side — BLOCKING

**Where:** `artifacts/vera-nexus/src/lib/privacyConsent.ts`.

The consent gate behaves correctly — it blocks the whole product until accepted,
and re-prompts everyone when `PRIVACY_POLICY_VERSION` changes. But the record
lives in `localStorage`, which means it is a value on the user's own device, on
a clock they control, that they can clear. It is not proof that anyone agreed to
anything.

The fix: two columns on `settingsTable` (`policy_version`,
`policy_accepted_at`), written by an authenticated endpoint when the button is
pressed, with the local copy kept only to avoid a round trip on page load. A
schema migration plus one route.

## 4. Deletion is built — but the account-deletion button is not

**Done:** `artifacts/api-server/src/lib/dataDeletion.ts` now backs section 7 for
real. `DELETE /chats/:id` cascades to the message log, attachment rows, the
files on disk *and* their extracted-text sidecars, goals, roadmaps, decision
cards and feedback. `DELETE /account` removes everything across all fifteen
user-scoped tables and then deletes the Clerk account.
`src/lib/dataDeletion.test.mjs` reads the schema directory and fails if a
user-scoped or chat-scoped table is ever added without being wired into the
cascade — which is what stops section 7 from quietly becoming false again.

**Still open:** there is no UI for account deletion. The endpoint exists and is
authenticated to the caller's own account, but nothing in Settings calls it, so
today a deletion request means someone invoking the endpoint on the user's
behalf. An irreversible destructive control deserves its own design pass
(confirmation, typed confirmation, what the user is shown afterwards), which is
why it was not bolted on.

Also unverified: whether the 30-day backup window in section 7 matches what the
hosting provider actually does. The policy states 30 days. Confirm it.

## 5. Get a lawyer to read sections 16, 17 and 18 — BLOCKING

These are the warranty disclaimer, the liability limit and the indemnity. They
are drafted to be as protective as honest drafting allows, and they include the
things that make such clauses survive rather than get struck out wholesale: an
express carve-out for what cannot be excluded (death or personal injury by
negligence, fraud, gross negligence, non-waivable consumer rights) and a
severability clause that narrows an over-broad term instead of voiding the
section.

What no drafting can do is make you unsuable. Anyone can file a claim; these
clauses limit what succeeds and what it costs. Two specifics worth a
professional eye:

- **Section 17 states no fixed liability cap.** An earlier draft capped total
  liability at "greater of 12 months' fees or US$100"; on the user's
  instruction that was removed, on the basis that a court should set the
  figure if it ever comes to that rather than the document pre-naming one.
  What remains is the general disclaimer plus the categorical exclusions
  (indirect/consequential damages, third-party acts, etc.). Worth knowing:
  this is not obviously *more* protective — a stated cap is a hard ceiling a
  court usually respects if reasonable, while "no cap, decided case by case"
  leaves the tail risk on direct damages technically open-ended, bounded only
  by the exclusions above it. Have the lawyer weigh in on whether to reinstate
  a cap once real usage numbers make picking one less arbitrary.
- **Mandatory training** (section 4) with no opt-out needs a lawful basis under
  the GDPR that is *not* consent — legitimate interests or contractual
  necessity — because consent must be freely given and revocable, and this is
  neither. The policy is worded to say honouring an objection means closing the
  account. A DPIA is likely required. This is the single most likely thing to
  attract a regulator's attention, and it is a deliberate product decision, so
  it should be a documented one.

## 6. Re-read the policy against the product

The policy was written against what the code did on 2026-08-15. Specifically
checked and true as of then:

- Uploads are **not** publicly served. There is no `express.static` on the
  uploads directory; files are reachable only through the authenticated
  `GET /attachments/:id`. If that ever changes, section 8 becomes false.
- The subprocessor list in section 5 is the real set of external services the
  server calls: Clerk (auth), Groq (inference), DuckDuckGo and Jina Reader (web
  search), the Postgres host, and connector providers only where a user connects
  one. **Adding any new external call means adding it to section 5** and bumping
  the policy version.
- OAuth tokens are AES-256-GCM encrypted at rest, separately from other data.

If you change what data goes where, the policy is now a document that can be
wrong. Treat a mismatch as a bug in one or the other, as section 12 says.

## 7. Do not restore the testimonials

**Where:** `artifacts/vera-nexus/src/pages/landing/Sections.tsx`, section 8.

Three fabricated customer quotes were deleted, along with their CSS, so no empty
slot remains. Invented endorsements presented as real customers are a deceptive
practice in their own right — the exposure does not depend on anyone being
fooled. When there are real, attributed, permissioned quotes, write the section
again from those.

The monthly-review mockup still uses the invented "Northwind Labs" and is
labelled "sample company" / "Example — not a customer's data". Keep the label if
you edit that section.

## 8. Still unaddressed from the original risk list

The list this work came from had ten items. The policy, the terms and the consent
gate cover most of them. These two are untouched:

- **Subscription and cancellation flow** — cancelling must not be harder than
  signing up, and auto-renewal needs advance notice. There is a
  `/enterprise/plan` and `/enterprise/checkout` in the funnel; neither was
  reviewed for this, and neither is mentioned in the policy because there is no
  billing behaviour to describe yet. When there is, it needs its own section.
- **Self-harm and crisis responses** — Vera has no defined behaviour for a user
  in distress. Section 16 of the terms now says explicitly that Vera is not
  medical, psychological or safety advice and must not be relied on for anything
  affecting someone's health or safety. That is a disclaimer, not a safety
  response. A model that responds to a founder in crisis with a growth tactic is
  a product problem a disclaimer does not solve.

---

# What is deliberately NOT claimed anywhere

Recorded so nobody "helpfully" strengthens these later. Each one was considered
and rejected because it would be false, and a false reassurance is the thing
that turns a complaint into a claim.

- **Not** "your data is never used for training" — it is, and that line was
  removed from the landing page for contradicting the policy.
- **Not** "we will never sell your data under any circumstances, ever" — section
  6 commits to not selling and does not reserve a right to start, but section 12
  governs any future change with advance notice rather than pretending the
  document can bind the company forever in silence.
- **Not** "your data is completely secure" or "cannot be breached" — section 8
  describes real measures and explicitly refuses to promise absolute security,
  because that promise becomes a misrepresentation the day it fails.
- **Not** "Vera's recommendations are accurate/reliable/verified" — section 16
  disclaims accuracy, including for the marketing phrase "the cause behind every
  decision", which is also disclaimed in the landing page footer where the claim
  is actually made.
- **Not** "deleted immediately and everywhere" — deletion is immediate in the
  live systems, and section 7 admits the 30-day backup window and the fact that
  content already absorbed into a trained model cannot be extracted back out.
