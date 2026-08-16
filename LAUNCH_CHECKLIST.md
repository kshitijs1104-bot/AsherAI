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

**UI built:** the General tab of VeraSettingsModal (`pages/GeneralSettings.tsx`,
reachable from the Settings button in the sidebar) has a "Delete account"
control. It requires typing "DELETE" (case-sensitive) before the confirm
button enables, shows what gets deleted before you commit, surfaces the
server's error message inline if deletion partially fails (data gone, Clerk
account still open — see account.ts's belt-and-braces branch), and signs the
browser out and redirects to `/` on success. Not yet tested against a real
database — `useDeleteAccount` in `venusApi.ts` and the confirmation flow were
verified in the browser against a stubbed/unreachable backend (the error path
renders correctly; the success path was not exercised end-to-end).

Note for later: the standalone `/settings` page (`pages/Settings.tsx`) is
**not linked from anywhere live** — its only linker was the archived Topbar.
A "Privacy & Terms" link was mistakenly added there first and a live user
could not find it. It has a comment now saying so; do not add anything there
expecting a founder to see it without also linking the page from somewhere
real.

Also unverified: whether the 30-day backup window in section 7, and the
90-day log-retention figure in the same section, match what the hosting
provider actually does. Both are stated as policy commitments, not read off
an infra config — confirm both, the same way you'd confirm any other number
in this document against reality.

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

- **Section 17 states no fixed liability cap, no claim-window, and no
  "a court decides the amount" language.** All three were removed on the
  user's explicit instruction, in two rounds — first the dollar figure
  (US$100/12-months), then the sentence that replaced it (a court decides) and
  the one-year limitation period, on the basis that the document should not
  put the mechanics of suing in front of a customer at all. What remains is
  the disclaimer plus the categorical exclusions (indirect/consequential
  damages, third-party acts, misuse, force majeure) and the mandatory
  carve-out for non-waivable liability (death/injury by negligence, fraud,
  gross negligence — kept because removing it risks the whole section being
  struck down, not because it was unflagged). Worth knowing: each removal
  trades a defined position for silence, and silence is not obviously safer —
  no stated cap means the tail risk on direct damages is open-ended rather
  than bounded, and no stated limitation period means the ordinary statutory
  one applies by default (which may be *longer* than a year, depending on
  jurisdiction). Have the lawyer weigh in on whether either is worth
  reinstating once real usage numbers exist.
- **Section 14's ownership claim was narrowed to match what each IP right
  actually covers**, per the user's read that Vera-the-system isn't something
  you copyright: trademark on the name/mark, copyright specifically on the
  page designs (landing page, chat interface, dossier, etc.), and trade secret
  / confidential-information + licence-restriction for the software, prompts,
  architecture and model configuration. This is more accurate than the
  original blanket "protected by copyright" claim over all of it — copyright
  doesn't reach an abstract system or method, only fixed expression — so a
  lawyer reviewing this should find it easier to defend, not harder.
- **Section 8 now states plainly that data is not shared with outside
  companies, advertisers or data brokers.** True as written — it names the
  processors in section 5 as the only exception and they're bound by
  contract — but keep it in sync if the vendor list in section 5 ever grows to
  include something that reads more like a third party than infrastructure.
- **The "in plain terms" summary and the "Read first" jump links are gone**
  from both the consent screen and the public page, on the user's instruction
  to let people read the actual document rather than a paraphrase. The
  practical effect: the reading pane now opens straight into section 1, with
  nothing shortcut to the surprising clauses (training, accuracy, liability).
  That is intentional, not a regression — flagging only so nobody "fixes" it
  back in without knowing it was deliberate.
- **Mandatory training's GDPR basis is now named** (section 4): performance of
  contract (Art. 6(1)(b)) for the core store-and-retrieve behaviour, legitimate
  interests (Art. 6(1)(f)) for broader model improvement, with the Art. 21
  right to object mapped onto account closure. Naming it is not the same as it
  surviving scrutiny — a legitimate-interests basis needs an actual balancing
  test/DPIA behind it, which a lawyer should do, not this document. This is
  still the single most likely thing to attract a regulator's attention.

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
- **Self-harm and crisis responses — NOW BUILT (2026-08-16).** This was the
  open item, and it stayed open long enough to be found in the live product: a
  founder typed "tell me should i kill myself" and Vera answered "I'm really
  sorry you're feeling like this, but I can't help with that" — with an
  **EXPLORATORY confidence badge under it reading "Grounded in a live web
  search plus general reasoning."** Two failures. The words were a door
  closing, and the badge was the product rating a suicide question as
  researched business analysis. The second is the worse one.

  `lib/crisisSupport.ts` now detects it and answers with named crisis lines
  (Tele-MANAS 14416 and AASRA for India, 988, Samaritans, findahelpline.com,
  plus emergency services), and it is wired as the **first** gate in
  `/ai/analyze` — ahead of the business-context gates and ahead of the Groq
  client check, because someone who has just said that must not be asked "same
  business or a new one?" or told an API key is missing. The model is never
  called, so there is no completion to refuse and nothing to badge.

  Two things to know before touching it. **Detection is tuned against founder
  language, which is full of violent idiom** — "career suicide", "kill the
  feature", "this fundraise is killing me", "dead in the water". There are 22
  such phrases in `crisisSupport.test.mjs` that must NOT trigger, alongside the
  ones that must; a false positive teaches people to ignore the message on the
  day it is meant for them. The suite already caught one real bug, where the
  "kill the *&lt;noun&gt;*" idiom silently ate "kill my self" written as two
  words. **Run those tests after any edit to the patterns.** Second, the
  response deliberately carries **no `confidence` field** — that omission is
  what stops EvidenceStrip rendering, and it is asserted in the suite. Do not
  add one.

  There is also a backstop in `ai.ts`: if the model produces its own safety
  refusal and detection missed the message, the reply is returned stripped of
  its confidence badge rather than dressed as analysis.

  Still not done, and worth being clear about: Vera does not detect distress
  expressed indirectly ("I've got nothing left", "I don't see the point in any
  of this"), which is how it more often actually arrives. That needs the model
  in the loop rather than patterns, and it is a real piece of work rather than
  a regex addition. Section 16's disclaimer still stands behind all of this —
  it is now a disclaimer with a safety response in front of it, which is the
  order those two belong in.

## 9. Proposed, not built: a personalization opt-out toggle

The user raised this while reviewing the policy: since training/storage is
compulsory (section 4), should there be a Settings toggle that turns off the
personalized/learning behaviour and runs Vera as a plainer, non-personalized
assistant instead — off by default, i.e. **on** once you accept the policy, with
an off switch in Settings?

**This is buildable, and here is what "training" actually is under the hood** —
checked before answering, so the recommendation is grounded rather than a
guess: there is no literal model fine-tuning per user. Groq is an inference API;
what makes Vera "learn" is retrieval — `company_facts`, the dossier, the decision
memory and the message log get written to on most turns
(`artifacts/api-server/src/routes/ai.ts`, the `addCompanyFact` calls) and read
back into the prompt on the next one (`memoryBlock` in the same file). A toggle
would realistically mean: stop writing to those tables, and stop injecting
`memoryBlock` into the prompt, while the base chat still works.

**Not built, because it is a real feature, not a copy edit** — a schema column,
a settings endpoint, changes to the read/write paths in `ai.ts`, and a Settings
UI control, plus follow-up edits to sections 4, 9 and 12 of the policy once it
exists (the "not optional" framing would need to change to describe the actual
opt-out mechanism). Building the toggle without touching those sections would
repeat the exact mistake this whole effort was fixing — a policy promising
something the code doesn't do, just in the opposite direction. Scope it as its
own piece of work before starting it.

## 10. A structural legal review came in — most of it is applied, one part is held for your confirmation

The user pasted a detailed outside review (not run by this assistant, and not
independently verified against current regulatory status — see the DPDPA
dates below) and asked for it to be implemented. Six new sections were added
(19-24, `ADDITIONAL_SECTIONS` in `privacyPolicy.tsx` — a new third array,
appended rather than inserted into the numbered flow, specifically so no
existing cross-reference like "section 5" or "section 16" had to be
renumbered) plus edits to sections 1, 2, 4, 7, 9, 10 and 13. `PRIVACY_POLICY_VERSION`
bumped to `-r5`.

**Applied:**

- Section 1: Vera stated explicitly as a business tool, not offered to
  consumers — the review's point that this single sentence is what keeps
  individual-consumer-protection statutes from attaching to a business user.
- Section 2: the excluded-sensitive-data list extended to GDPR Art. 9/10
  special categories (political opinion, religion, trade union membership,
  sexual orientation, criminal record) alongside the existing health/biometric/
  government-ID list.
- Section 4: GDPR Art. 6 lawful basis named directly (contract necessity for
  core storage/retrieval, legitimate interests for broader improvement), with
  the Art. 21 right to object mapped onto the existing account-closure
  mechanism. This is the fix for the review's flagged GDPR exposure — see
  item 5 above for what still needs a lawyer's judgement on top of it.
- Section 7: log retention given an actual number (90 days) instead of "a
  short operational window" — unverified against real infra, see item 4.
- Section 9: CCPA appeal right (45-day response) and non-discrimination
  commitment added; the CCPA-defined terms "sold" and "shared" used explicitly
  rather than relying on the colloquial "we don't sell."
- Section 10: international-transfer mechanism named specifically (EU
  Standard Contractual Clauses, UK IDTA) instead of "standard contractual
  protections."
- Section 13: the contact address given an explicit DPDPA Grievance Officer
  role and a stated response window (7-day acknowledgement, 30-day
  resolution) — cheap now, per the review, expensive to retrofit once DPDPA
  enforcement phases in.
- New section 19 (Cookies): audited against the actual codebase before
  writing a word of it — there is no analytics or advertising tracking
  anywhere in this app (checked `package.json` and the source tree). The only
  cookies are Clerk's session cookie, a first-party sidebar-state preference
  cookie, and a transient OAuth-state cookie during connector setup. All
  three are within the ePrivacy "strictly necessary" exemption, so the
  section states this plainly rather than adding a consent banner nothing
  requires. If analytics is ever added, this section — and a real banner —
  need to change with it.
- New section 20 (California privacy rights): a categories-of-information
  table in the format CCPA/CPRA expects, plus the appeal and
  non-discrimination language cross-referenced from section 9.
- New section 21 (IP notice-and-takedown): included for completeness and
  worded honestly about the fact that it barely applies today — uploaded
  files are never shared between users, so the situation a DMCA-style process
  exists for doesn't really arise yet. If dossier-sharing or any multi-user
  visibility of uploaded content is ever built, this section stops being
  mostly theoretical and the process it describes needs to be real (a
  monitored inbox, at minimum).
- New sections 22-24: survival clause (which sections outlive account
  closure), assignment clause (mirrors the acquisition scenario already in
  section 5), and a short definitions section.

**Resolved — you confirmed after seeing the conflict, both are now applied.**
Section 17 states a liability cap again (greater of 12 months' fees or
US$100 — the same figure that was removed in `-r3`; reinstated on your
explicit instruction, not silently). New section 24, "Dispute resolution",
adds binding individual arbitration seated in India under the Arbitration and
Conciliation Act 1996, a class-action waiver, carve-outs for injunctive
relief (IP/confidentiality) and small-claims matters, and a fallback court
venue for anything not arbitrated. `PRIVACY_POLICY_VERSION` bumped to `-r6`.
This is a real reversal of an earlier explicit instruction ("don't give
people ideas to do shit"), made consciously after the direct conflict was
put in front of you — recorded here so it reads as a decision, not drift.

Two things from the same cluster were **not** part of what you confirmed and
are still open:

- **Arbitration seat has no named city** — the clause says "seated in India"
  (reading `POLICY_META.jurisdiction`) without a specific city, which is
  legally workable but crisper with one named. Add a city once you have one,
  the same way `POLICY_META.parentEntity` is a fill-in-later placeholder.
- **The one-year claim-filing window and the mutual IP indemnity** (Vera
  indemnifying you, not just you indemnifying Vera) were both flagged in the
  original review alongside the cap/arbitration items, but neither was in the
  option you actually picked — only "the cap + arbitration/venue/class-waiver"
  was. Both are still out. Say explicitly if you want either added; don't
  assume this round covered them.

**Not independently verified — the review's own claims, not this assistant's
research:** the DPDPA implementation timeline it cites (Rules notified
November 2025, Consent Manager registration opening November 2026, Phase 3
operational obligations from 13 May 2027) is stated as fact in the pasted
review but was not confirmed against a live regulatory source here. It reads
as plausible and the response taken — designate a Grievance Officer now,
cheaply, ahead of enforcement — is sound regardless of whether the exact dates
are right. Have the lawyer confirm the dates before relying on "we have more
runway than we thought" as a reason to deprioritise anything.

---

# 10. Application security pass (2026-08-16)

Worked through a 20-item pre-launch hardening list. Most of it was already
done by the earlier CORS/auth/rate-limit work. What follows is only what
changed, and what could not be changed from code.

## Fixed in this pass

- **The checkout page was collecting card numbers.**
  `pages/enterprise/Checkout.tsx` rendered cardholder name, PAN, expiry and
  CVC under the heading "Secure checkout" with a $299/mo price, then ran a
  1.8-second `setTimeout` and unlocked the app. Nothing was sent anywhere; the
  only disclosure was 11px grey text *below* the submit button. Three separate
  problems — cardholder data on an origin with no processor and no PCI scope,
  a user reasonably believing they had subscribed when no charge and no record
  existed, and a page shaped exactly like a phishing form. The form is gone
  and the screen now says plainly that billing isn't live and no card is
  needed. **When billing is real it must be Stripe Checkout or Elements, so
  the PAN never enters this app's DOM, and the amount must come from a
  server-resolved price ID — never a number in the client bundle.** Read the
  header comment in that file before touching it.
- **CSRF.** Auth here is a cookie, and CORS does not stop a cross-site write —
  it only stops the attacker reading the reply. The only thing standing in the
  way was Clerk's SameSite=Lax default, which is a third party's dashboard
  setting, not a control in this repo. `middlewares/csrf.ts` now requires
  every POST/PUT/PATCH/DELETE to carry either an allowed `Origin` or an
  `Authorization: Bearer` header. `express.urlencoded` was removed at the same
  time (nothing used it) since it was one of the two no-preflight paths in.
- **Daily cap on model calls.** The 30/min limiter allowed 43,200 model calls
  per user per day. Groq bills against an org-wide daily quota, so one looping
  account could exhaust everyone's. Now **250 per user, then a five-hour
  cooldown**, on `/ai` + `/actions` — see `middlewares/usageLimit.ts`.
  Deliberately not `express-rate-limit`: its fixed window starts at the first
  request of the window, so an exhausted user could be free again minutes
  later. The cooldown is timed from the moment the budget runs out, which is
  the whole point of calling it one.

  Two things to know before changing the numbers. **The cooldown is what
  refills the budget**, so somebody deliberately maxing out gets 250 every five
  hours — around 1,200 in a day, not 250. That is the arithmetic of "cap then
  cooldown", it is still ~36x tighter than what it replaced, and if a hard
  250-per-24h is wanted instead, set `COOLDOWN_MS` to `BUDGET_WINDOW_MS`.
  Second, **`budgetFor(req)` is the seam for paid plans** — when Pro and
  Enterprise get real numbers, read the plan there and return its budget rather
  than threading a tier through the middleware.
- **OAuth state cookie had no `secure` flag** — the one secret the connector
  CSRF guard compares was allowed to travel in clear. Also now scoped to
  `/api/connectors`, with `clearCookie` given matching attributes so the
  single-use value is actually deleted rather than left replayable.
- **Frontend served no security headers at all.** The API had helmet; the
  pages founders actually log into had nothing. `vite.config.ts` now sets
  HSTS, `frame-ancestors 'none'` + `X-Frame-Options: DENY` (there is a
  one-click "Delete account" behind auth — prime clickjacking bait), nosniff,
  `Referrer-Policy` and `Permissions-Policy`.
- **Security-event logging.** Rate-limit trips, blocked cross-origin writes,
  rejected uploads and attachment-ownership misses now log at warn with the
  key/origin, never the body. Previously they were invisible — a 429 or 404
  with nothing recorded server-side.
- **Cookie/local-storage handling — built, audited, and deliberately NOT shown
  as a banner.** `lib/cookieConsent.ts` + `pages/legal/CookieBanner.tsx`.

  The audit split what Vera keeps on a device into required (session cookie,
  OAuth state, the consent records, signup progress, and your own chat index)
  and preferences (theme, skin, panel layout, dismissals, one refetchable
  cache). The conclusion was that **none of it requires consent**: there is no
  analytics, advertising, third-party tag or cross-site tracking, and no IP
  storage, which leaves user-interface customisation the founder set by
  clicking something — the textbook consent-exempt case. So the banner is not
  displayed. A consent request for a dark-mode setting is theatre, and it
  trains people to click past the notice that will matter later.

  The machinery is retained and wired, behind one boolean: `CONSENT_REQUIRED`
  in `lib/cookieConsent.ts`. Flip it to `true` and the banner mounts,
  preference storage becomes opt-in, and declining purges. **Verified both
  ways in the browser, not assumed** — off: no banner, preferences persist;
  on: banner renders with both buttons. That switch's comment lists exactly
  what obliges you to flip it (any analytics/telemetry SDK, any pixel, any
  third-party embed with its own storage, storing IPs or fingerprints,
  profiling). Section 19 must change in the same commit if you do.

  What ships today instead of a banner: preference storage is on by default,
  with a real off switch in Settings → General that also deletes what was
  stored. The one behaviour to know if you touch `isPreferenceStorageAllowed`
  is that its default INVERTS with the switch — under consent it must default
  to off, without consent it must default to on, or removing the banner
  silently stops every preference from persisting with nothing on screen to
  explain why.
- **Clerk telemetry disabled.** It ships on by default and was running — which
  is how `clerk_telemetry_throttler` appeared in local storage during the audit
  — while section 19 said there is no analytics on the site. Now
  `telemetry={{ disabled: true }}` on ClerkProvider, so the sentence is simply
  true. Change one and you must change the other.
- **Policy section 19 rewritten, and version bumped to `-r7`.** The old text
  described a sidebar *cookie* the live app never sets
  (`components/ui/sidebar.tsx` has no importers — the real setting is local
  storage under a different name), and disclosed only cookies while the app
  keeps a dozen items in local storage it never mentioned. It now lists what is
  actually there, splits it into required and preferences, points at the
  Settings control, and explains why there is no banner rather than leaving it
  unaddressed.

  It also says plainly that **IP addresses are not stored** — checked against
  the code, not assumed: `req.ip` is a transient in-memory rate-limit key for
  unauthenticated requests, and the pino serializer records only method and
  path. This was asked for as a disclosure and is deliberately written the
  other way round, because Vera does not hold IPs and saying it does would be a
  false statement in a privacy notice. Over-claiming is not the safe direction;
  it is just inaccurate in the opposite one, and it invites the question "where
  is it, then?", which has no answer. **If IP logging is ever added, this
  sentence is the thing that becomes false** — change it in the same commit,
  bump the version, and give the processing a lawful basis in section 4.

## Already covered before this pass — do not "fix" again

CORS allowlist with a fatal-on-unset production check; 256kb JSON body ceiling
and 10MB upload ceiling; upload type allowlist by extension with a
server-generated random filename; no `express.static` anywhere (so no
directory listing, and uploads are only reachable through the authenticated
`GET /attachments/:id`); dead admin/debug routers deleted rather than guarded;
5xx error messages replaced with a fixed string so table names and paths don't
leak; prompt-injection fencing on every untrusted-text path into the model
(web search, attachments, dossier extraction, connector-sourced drafts).
Passwords, reset links, session invalidation on password change, login
lockout, and user-enumeration defences are all Clerk's — this codebase never
sees a password.

## Not fixable from code — these are yours

1. **Database permissions.** `lib/db/src/index.ts` connects with whatever
   `DATABASE_URL` grants, which on a provisioned Postgres is usually the owner
   role. The app needs SELECT/INSERT/UPDATE/DELETE on its own tables and
   nothing else — not CREATE, not DROP, not superuser. Make a restricted role,
   run migrations as the owner separately, and point `DATABASE_URL` at the
   restricted one.
2. **Confirm Clerk's session cookie is still SameSite=Lax** and that lockout
   and reset-rate-limiting are enabled in the Clerk dashboard. The CSRF
   middleware means Vera no longer *depends* on the first one, but it should
   not be silently relaxed either.
3. **A real document CSP** (`script-src`/`connect-src`). Deliberately not
   guessed at — this app loads Clerk and Google Fonts from third-party
   origins, and a CSP written blind either allows everything or breaks sign-in
   in production only. Write it against the deployed origin list and test the
   auth flow.
4. **The usage cap counts per process.** In-memory, so on autoscale the real
   ceiling is 250 × instances and a redeploy clears every cooldown. Worth
   moving to a shared store or a `usage_daily` row once there's a paid Groq
   tier and a bill worth the difference — and note this becomes load-bearing
   the moment plans are priced on usage, because at that point the counter is
   billing data, not just an abuse control.
5. **The plan tiers on `/enterprise/plan` are not enforced anywhere.** Free,
   Pro and Max advertise different limits; the server applies none of them.
   Not a security hole today (nobody is paying), but it becomes a false
   advertising problem the day someone does.

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
