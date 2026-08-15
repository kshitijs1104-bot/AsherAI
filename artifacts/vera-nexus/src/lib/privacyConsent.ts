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
export const PRIVACY_POLICY_VERSION = '2026-08-15-r2';

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
