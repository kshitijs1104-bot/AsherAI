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

## 2. Own the contact address — BLOCKING

**Where:** same file, `POLICY_META.contactEmail`, currently `privacy@vera.ai`.

Section 9 points people at this address for every right the policy grants:
access, correction, deletion, opting out of training, opting out of sale. If it
does not exist or nobody reads it, the policy grants rights that cannot be
exercised, which is worse than not granting them.

Also confirm `POLICY_META.jurisdiction` — currently `India`, which was assumed
from context, not verified. It sets governing law and the transfer language in
section 10.

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

## 4. Make deletion real, or keep the manual promise

**Where:** `artifacts/api-server/src/routes/attachments.ts` (no DELETE route),
`artifacts/api-server/src/routes/chats.ts` (`DELETE /chats/:id` removes the chat
and its goals, but leaves the permanent message log and attachment rows/files).

Section 7 of the policy is honest about this — it says uploads and the message
log are not yet deletable in-app and that you will delete them on request within
30 days. That is a promise a human has to keep, by hand, for every request, and
there is currently no tooling to do it with.

Either build the deletion path, or make sure someone is actually able to honour
the manual one before a request arrives.

## 5. Re-read the policy against the product

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

## 6. Do not restore the testimonials

**Where:** `artifacts/vera-nexus/src/pages/landing/Sections.tsx`, section 8.

Three fabricated customer quotes were deleted, along with their CSS, so no empty
slot remains. Invented endorsements presented as real customers are a deceptive
practice in their own right — the exposure does not depend on anyone being
fooled. When there are real, attributed, permissioned quotes, write the section
again from those.

The monthly-review mockup still uses the invented "Northwind Labs" and is
labelled "sample company" / "Example — not a customer's data". Keep the label if
you edit that section.

## 7. Still unaddressed from the original risk list

The list this work came from had ten items. The policy and the consent gate
cover most of them. These two are untouched:

- **Subscription and cancellation flow** — cancelling must not be harder than
  signing up, and auto-renewal needs advance notice. There is a
  `/enterprise/plan` and `/enterprise/checkout` in the funnel; neither was
  reviewed for this.
- **Self-harm and crisis responses** — Vera has no defined behaviour for a user
  in distress. Section 15 of the terms says Vera is not a substitute for a
  qualified human, which is a disclaimer, not a safety response.
