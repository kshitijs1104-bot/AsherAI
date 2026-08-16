/* ---------------------------------------------------------------------------
   Whether this person has agreed to the current privacy policy.

   Versioned deliberately. Storing a boolean would mean that editing the policy
   to say something materially different — adding a use, adding a recipient —
   leaves everyone marked as having agreed to wording they never saw. Storing
   the version they accepted means a bump re-asks everyone, which is the only
   consent record that stays true as the document changes.

   BUMP THIS whenever the MEANING of pages/legal/privacyPolicy.tsx changes. Not
   for typos or reordering; yes for anything that changes what we may do.
--------------------------------------------------------------------------- */

import { useSyncExternalStore } from 'react';

// Bumped from '2026-08-15' when the policy was revised: training became
// explicitly non-optional, the possible-future-sale clause was removed and
// replaced with a commitment not to sell, deletion promises were tightened to
// match the cascade in the API, and the warranty/liability sections were added.
// Every one of those changes the meaning of what someone agreed to, so the
// earlier acceptance no longer covers it and everyone is asked again.
//
// Bumped again, -r2 to -r3: section 17 no longer states a fixed liability cap
// (previously "greater of 12 months' fees or US$100"). It now disclaims
// liability generally and leaves the existence and amount of any liability, if
// one is ever found, to a court applying the governing law — a materially
// different term from a pre-agreed number, so it re-prompts too.
//
// Bumped again, -r3 to -r4: section 14's ownership claim was narrowed to what
// each right actually covers (trademark on the name/mark, copyright on the
// page designs, trade secret on the software/prompts/architecture, rather than
// one blanket copyright claim over all of it); section 17 dropped two more
// sentences (the "a court decides the amount" line and the one-year claim
// window); section 8 added an explicit no-third-party-sharing commitment; and
// the "in plain terms" summary + jump-link shortcut were removed from the
// consent screen and the public page in favour of the actual document. Every
// one of those is a real change to what the text says, so it re-prompts too.
//
// Bumped again, -r4 to -r5, following a structural/substantive legal review:
// section 1 now states Vera is a business tool, not offered to consumers;
// section 2's excluded-data list now covers GDPR special categories; section
// 4 names the GDPR Article 6 lawful basis for storage/training and the
// Article 21 right to object, rather than leaving it implicit; section 7
// gives an actual number (90 days) for log retention instead of "a short
// window"; section 9 adds a CCPA appeal right and a non-discrimination
// commitment; section 10 names Standard Contractual Clauses specifically
// instead of "standard contractual protections"; section 13 designates the
// contact as a DPDPA Grievance Officer with a stated response window. Six
// entirely new sections were added (19-24, in the new ADDITIONAL_SECTIONS
// array): cookies, California-specific rights with a categories table, an
// IP notice-and-takedown process, a survival clause, an assignment clause,
// and definitions. Every one of these is new information a reader has not
// seen before, so it re-prompts everyone again.
//
// Bumped again, -r5 to -r6: section 17 states a liability cap again (greater
// of 12 months' fees or US$100 — removed in -r3, reinstated here on explicit
// instruction after being shown that it directly reversed that earlier
// decision). New section 24, "Dispute resolution", adds binding individual
// arbitration and a class-action waiver, which did not exist in any earlier
// version — this is new obligation a reader is taking on, not a
// clarification, so it gets its own bump rather than riding along with
// something else. Definitions renumbered 24 -> 25 to make room for it.
// Bumped again, -r6 to -r7: section 19 (cookies) was rewritten because it did
// not match the code. It described a sidebar cookie the live app never sets
// (components/ui/sidebar.tsx has no importers — the real setting is in local
// storage under a different name), and it disclosed only cookies while the app
// keeps a dozen items in local storage it never mentioned. The section now
// lists what is actually stored, splits it into required and preferences,
// points at the Settings control that switches the preferences off, and says
// plainly that IP addresses are NOT stored — checked against the code rather
// than assumed, since claiming to hold data you do not hold is its own kind of
// inaccurate notice.
//
// It also now explains why there is no cookie banner, which is a change of
// position from "none of these need one" to a stated reason. A banner was
// built and then deliberately not shown: nothing here is tracking, advertising
// or analytics, so nothing here requires consent. The machinery is still in
// the codebase behind lib/cookieConsent.ts's CONSENT_REQUIRED — if that is
// ever flipped on, section 19 has to change back in the same commit and this
// version bumps again.
export const PRIVACY_POLICY_VERSION = '2026-08-15-r7';

const KEY = 've_privacy_consent';

export interface PrivacyConsent {
  version: string;
  /** ISO timestamp, from the browser's clock — see the caveat below. */
  acceptedAt: string;
}

export function getPrivacyConsent(): PrivacyConsent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PrivacyConsent>;
    if (typeof parsed?.version !== 'string') return null;
    return { version: parsed.version, acceptedAt: parsed.acceptedAt ?? '' };
  } catch {
    return null;
  }
}

/** True only for the version currently in the app. An older acceptance re-asks. */
export function hasAcceptedPrivacy(): boolean {
  return getPrivacyConsent()?.version === PRIVACY_POLICY_VERSION;
}

export function acceptPrivacy(): void {
  try {
    const record: PrivacyConsent = {
      version: PRIVACY_POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage blocked (private mode, disabled cookies). Nothing to do: the
    // consent screen will simply be shown again next time, which is the safe
    // direction for this particular failure to fall in.
  }
  emit();
}

/** For testing the first-run screen without clearing the whole origin. */
export function resetPrivacyConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  emit();
}

/* ------------------------------------------------------- reading it in React */

// Two separate components need this answer and must never disagree about it:
// the gate that blocks the app, and the skin picker that would otherwise open a
// second dialog on top of the first. A store rather than a context because the
// two are mounted in different subtrees — the picker sits beside the router, not
// inside it — so there is no common provider to hang a context on that isn't
// just "wrap the whole app to share one boolean".

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// hasAcceptedPrivacy is passed as the snapshot function because it returns a
// boolean. useSyncExternalStore compares snapshots by identity, so a function
// returning the parsed object instead would allocate a fresh one on every read
// and re-render without end.
//
// The third argument is the server snapshot. This app is a client-rendered SPA,
// so it is unreachable today; it returns false anyway because that is the
// direction this particular default should fail in — "not yet accepted" shows a
// screen that can be dismissed by accepting, while "accepted" would wave
// somebody straight past it.
export function usePrivacyAccepted(): boolean {
  return useSyncExternalStore(subscribe, hasAcceptedPrivacy, () => false);
}

// ---- KNOWN LIMIT, WORTH FIXING BEFORE YOU HAVE REAL USERS ----
//
// This record lives in the browser only. That is enough to make the screen
// behave correctly — it blocks until accepted, and re-blocks when the policy
// changes — but it is NOT proof of consent: it is a value the user's own device
// holds and can clear, on a clock they control, with no server-side record that
// the agreement ever happened.
//
// The durable version is two columns on settingsTable (policy_version,
// policy_accepted_at) written by an authenticated endpoint when the button is
// pressed, with this local copy kept only to avoid a round trip on every page
// load. That needs a schema migration and a route, so it is deliberately not
// done here rather than half-done.
