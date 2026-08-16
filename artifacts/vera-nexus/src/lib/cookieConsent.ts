/* ---------------------------------------------------------------------------
   Cookies and local storage: what Vera keeps on your device, and your choice
   about the part of it that is optional.

   READ THIS BEFORE ADDING A CATEGORY OR A KEY.

   The rule this file exists to enforce: a consent banner is only worth having
   if declining actually changes what happens. A banner whose "reject" button
   sets a flag that nothing reads is worse than no banner at all — it collects
   a refusal, ignores it, and creates a written record that you ignored it.
   So every optional key is registered in PREFERENCE_KEYS below, writes to them
   go through `prefStorage` (which refuses when consent was not given), and
   declining PURGES anything already stored. If you add a key that is not
   strictly necessary and do not register it here, the banner starts lying.

   WHAT IS ACTUALLY STORED — audited against the code on 2026-08-16, not
   assumed from a template:

   ESSENTIAL (no consent asked, because none of it is optional — each item is
   either required to deliver the product you asked for, or is the record of a
   choice you made about the product):
     - Clerk's session cookie. How you stay signed in. Set by the auth
       provider, not by this file.
     - A short-lived OAuth state cookie, set server-side for the few seconds it
       takes to connect Gmail/Notion/etc, to verify the request came from you.
       See api-server routes/connectors.ts. Deleted immediately after.
     - `ve_privacy_consent` — which version of the privacy policy you accepted.
     - `ve_cookie_consent` — this choice. Storing the refusal is itself
       necessary; the alternative is asking again every page load.
     - `ve_gate_*` — where you are in signup. Required to resume the flow.
     - `ve_chat_sessions`, `ve_open_chat`, `ve_saved_analyses` — YOUR OWN
       CONTENT, and the reason they are on this list rather than the optional
       one is worth stating plainly, because the obvious reading is that a
       "local copy" must be a convenience.

       IT IS NOT. Venus.tsx builds the chat sidebar from `getSessions()` and
       nothing else — there is no server-backed chat list in the UI. Gating
       those writes on consent would mean anyone choosing "essential only"
       loses the index of their own conversations on every reload. The chats
       still exist server-side, but nothing in the product would list them, so
       in practice they would be unreachable.

       That fails twice over. It is data loss dressed up as a privacy setting,
       and it makes the consent coercive — "decline and lose your history" is
       not a freely given choice, which is the one thing consent has to be.
       Storage that is strictly necessary to deliver the service the user
       actually asked for is exempt from consent in the first place, and a
       chat product's record of your chats is the textbook case.

       DO NOT MOVE THESE THREE TO PREFERENCE_KEYS. If the sidebar ever gains a
       real server-backed list, this becomes a genuine choice and they can move
       — but only then, and the policy text has to move with them.

   OPTIONAL — "preferences" (this is what the banner asks about):
     see PREFERENCE_KEYS.

   WHAT IS **NOT** STORED, recorded because over-disclosure is its own kind of
   inaccurate notice and someone will eventually be tempted to add it:
     - There is NO analytics, advertising, or cross-site tracking technology in
       this app. No Google Analytics, no pixel, no third-party tag. Nothing
       here follows anyone to another website.
     - Vera does NOT store your IP address. The server uses the connecting IP
       transiently, in memory, as a rate-limiting key for requests that are not
       signed in (see api-server app.ts `userOrIpKey`), and the request logger
       is configured to record only method and path. It is never written to the
       database and never associated with your account. If that ever changes it
       belongs in the privacy policy as a processing purpose with a lawful
       basis — NOT in this file as a "cookie", because it is not one.
--------------------------------------------------------------------------- */

import { useSyncExternalStore } from 'react';

/* ---------------------------------------------------------------------------
   THE SWITCH — read this before changing it, and before adding anything that
   stores data.

   `false` (today): no banner is shown, and optional storage is ON by default.
   `true`: the banner in pages/legal/CookieBanner.tsx mounts, optional storage
   is OFF until someone accepts, and everything below behaves as opt-in.

   WHY IT IS OFF. Vera has nothing that legally requires consent. There is no
   analytics, no advertising, no third-party tag, no cross-site tracking, and
   no IP address stored. What is left is user-interface customisation the
   founder set by clicking something — their theme, which panels they left
   open, which cards they dismissed — and preference storage of exactly that
   kind, set as the result of an explicit user choice, is the textbook
   consent-exempt case rather than a grey area.

   So the banner was removed, on the user's call, and the reasoning is worth
   recording because it is not laziness: a consent banner asking permission for
   things that are exempt is theatre. It trains people to dismiss the one
   screen that will matter later, and it invites the reasonable question of
   what exactly is being asked about — to which the honest answer would have
   been "your dark mode setting".

   WHEN YOU MUST FLIP IT BACK TO `true`. Any one of these is sufficient, and
   none of them are hypothetical for a product that intends to grow:

     - Any analytics or product-telemetry SDK (PostHog, GA, Mixpanel, Segment,
       Sentry session replay). Note Clerk's own telemetry ships ON by default
       and is switched off in App.tsx — re-enabling it counts.
     - Any advertising, remarketing or conversion pixel.
     - Any third-party embed that sets its own storage (chat widgets, heatmaps,
       A/B tools, most video embeds).
     - Storing the IP address, device fingerprint, or any behavioural log tied
       to a person rather than aggregated.
     - Any storage used to profile someone, rather than to render the UI they
       asked for.

   Flipping it is this one boolean: the banner, the enforcement in prefStorage,
   the purge and the Settings control are all still here and still wired. What
   you must ALSO do in the same change is update section 19 of
   pages/legal/privacyPolicy.tsx and bump PRIVACY_POLICY_VERSION — the policy
   describes this behaviour, and the two going out of sync is the specific
   failure this whole area of the codebase exists to prevent.
--------------------------------------------------------------------------- */
export const CONSENT_REQUIRED = false;

// Separate from PRIVACY_POLICY_VERSION on purpose. The two documents change
// for different reasons and at different times: adding a preference key should
// re-ask about cookies without invalidating someone's acceptance of the whole
// privacy policy, and rewording a liability clause should not re-open the
// cookie banner. Bump this when the CATEGORIES or what they cover change —
// not when a key is renamed.
export const COOKIE_CONSENT_VERSION = '2026-08-16-r1';

const KEY = 've_cookie_consent';

/**
 * Every optional key this app writes, and the plain-English reason it exists.
 * The banner's detail panel renders straight from this, so the list a user
 * reads can never drift from the list the purge actually clears.
 *
 * THE TEST for putting a key here: if this value vanished, would the founder
 * lose anything they made, or only have to set something again? Only the
 * second kind belongs on this list. Nothing here holds content — it is
 * cosmetics, panel positions, dismissals, and one recomputable cache.
 *
 * `prefix: true` means "this and everything starting with it" — GoalPanel
 * writes one key per goal.
 */
export const PREFERENCE_KEYS: readonly { key: string; prefix?: boolean; what: string }[] = [
  { key: 've_theme', what: 'Whether you last used Vera in dark or light.' },
  { key: 've_skin', what: 'Which of the three visual identities you chose.' },
  { key: 've_sidebar_collapsed', what: 'Whether you left the sidebar open or collapsed.' },
  { key: 've_show_goal_panel', what: 'Whether the goal panel is showing.' },
  { key: 've_show_roadmap', what: 'Whether the roadmap panel is showing.' },
  { key: 've_company_reports', what: 'A cache of company reports already fetched, so the same one is not requested twice. Rebuilt automatically if cleared.' },
  { key: 've_cc_hidden', what: 'Which command-centre cards you dismissed, so they stay dismissed.' },
  { key: 've_today_seen', what: "Whether you have already dismissed today's card." },
  { key: 've_outcome_reminder_seen_', prefix: true, what: 'Which goal reminders you have already seen today.' },
];

export type CookieDecision = 'all' | 'essential-only';

export interface CookieConsent {
  version: string;
  decision: CookieDecision;
  /** ISO timestamp from the browser's clock — same caveat as privacyConsent. */
  decidedAt: string;
}

export function getCookieConsent(): CookieConsent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsent>;
    if (parsed?.decision !== 'all' && parsed?.decision !== 'essential-only') return null;
    if (typeof parsed.version !== 'string') return null;
    return { version: parsed.version, decision: parsed.decision, decidedAt: parsed.decidedAt ?? '' };
  } catch {
    return null;
  }
}

/**
 * Whether the banner still has a question to ask. Always true when consent
 * isn't required, so the banner never mounts — see CONSENT_REQUIRED.
 */
export function hasDecidedCookies(): boolean {
  if (!CONSENT_REQUIRED) return true;
  return getCookieConsent()?.version === COOKIE_CONSENT_VERSION;
}

/**
 * The question the rest of the app actually asks.
 *
 * THE DEFAULT FLIPS WITH `CONSENT_REQUIRED`, and getting that wrong is the
 * whole reason this function is not a one-liner. Under consent, the answer
 * before anyone has chosen must be NO — a banner that writes preferences while
 * it is still on screen has already done the thing it is asking permission
 * for. Without consent required, the answer must be YES, because otherwise
 * removing the banner would leave every preference write silently no-opping
 * and the founder's theme, panel layout and dismissals would stop persisting
 * with nothing on screen to explain why.
 *
 * An explicit opt-out is honoured in BOTH modes. Someone who turned this off
 * in Settings stays off — the switch above governs whether we ask, never
 * whether we listen to an answer already given.
 */
export function isPreferenceStorageAllowed(): boolean {
  const consent = getCookieConsent();
  if (consent?.decision === 'essential-only') return false;
  if (!CONSENT_REQUIRED) return true;
  return consent?.version === COOKIE_CONSENT_VERSION && consent.decision === 'all';
}

function record(decision: CookieDecision): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: COOKIE_CONSENT_VERSION, decision, decidedAt: new Date().toISOString() } satisfies CookieConsent),
    );
  } catch {
    // Storage unavailable (private mode, storage disabled). The banner will be
    // shown again next load and optional storage stays off in the meantime,
    // which is the safe direction for this failure.
  }
  emit();
}

export function acceptAllCookies(): void {
  record('all');
}

/**
 * Declining is not just a flag — it clears anything already written under the
 * optional keys. Without this, someone who accepted, used the product, then
 * changed their mind would keep every preference value on disk while the
 * record said they had refused.
 */
export function acceptEssentialCookiesOnly(): void {
  record('essential-only');
  purgePreferenceStorage();
}

export function purgePreferenceStorage(): void {
  try {
    const exact = new Set(PREFERENCE_KEYS.filter((k) => !k.prefix).map((k) => k.key));
    const prefixes = PREFERENCE_KEYS.filter((k) => k.prefix).map((k) => k.key);
    // Collect first, delete after — removing during iteration over
    // localStorage's live index skips entries.
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (exact.has(key) || prefixes.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Nothing to do — if storage can't be read it can't have been written to.
  }
}

/** Lets someone change their mind from Settings; re-shows the banner. */
export function resetCookieConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  purgePreferenceStorage();
  emit();
}

/* --------------------------------------------------- the enforced storage */

/**
 * Use this instead of `localStorage` for anything in PREFERENCE_KEYS.
 *
 * Reads are always permitted: a value that is already there was either written
 * with consent or is about to be purged, and refusing to READ it would only
 * break the UI without deleting anything. WRITES are what consent governs.
 */
export const prefStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    if (!isPreferenceStorageAllowed()) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Best-effort, exactly as the raw calls this replaced were. Every caller
      // already tolerates the preference not surviving the session.
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

/* ------------------------------------------------------- reading it in React */

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True once a choice for the current version exists. Drives the banner. */
export function useCookieDecided(): boolean {
  return useSyncExternalStore(subscribe, hasDecidedCookies, () => true);
}

/** The current answer, for the Settings control that shows and changes it. */
export function usePreferenceStorageAllowed(): boolean {
  return useSyncExternalStore(subscribe, isPreferenceStorageAllowed, () => false);
}
