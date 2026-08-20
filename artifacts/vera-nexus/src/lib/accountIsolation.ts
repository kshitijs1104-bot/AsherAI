import { resetGate } from './enterpriseGate';

/* ---------------------------------------------------------------------------
   THE BUG THIS CLOSES: a shared browser leaking one account's content into
   another.

   Reported live: hydro.byte90@gmail.com, an email that had never signed up
   before, saw chats belonging to two other founders (kshitij, igneel) who had
   previously used Vera on the same browser. Not a Clerk problem and not a
   server problem — the backend scopes every chat query by the authenticated
   userId (see api-server routes/chats.ts) and Clerk correctly created a new,
   distinct account for the new email. The leak is entirely client-side:
   localStorage is scoped to the ORIGIN, not to the signed-in user, and
   nothing here ever cleared it when a different account signed in.

   `ve_chat_sessions` (lib/venusHistory.ts) stores the actual message content
   of every chat, not just titles — Venus.tsx builds the sidebar and the
   thread view straight from it with no server round trip. So the leak was
   real conversation content, reachable the instant a second person signed
   into the same browser.

   Worse than a display bug: `repairServerProfile` in lib/enterpriseGate.ts
   runs on every authenticated mount, reads `ve_gate_onboarding` from
   localStorage, and — if the CURRENTLY signed-in account's server profile is
   still empty — POSTS those answers to it. A stale onboarding record left by
   a previous account on the same browser would silently become the new
   account's company name, revenue and headcount.

   THE FIX: one guard, called once per known identity, before any page gets a
   chance to read the keys above. Same account as last time (including the
   ordinary case of the very first sign-in on a fresh browser, where nothing
   is recorded yet): no-op, history behaves exactly as it always has. A
   DIFFERENT account than the one that last used this browser: every key that
   holds real content is purged first.

   Deliberately NOT purged: ve_theme, ve_skin, ve_sidebar_collapsed,
   ve_show_goal_panel, ve_show_roadmap, ve_cookie_consent. Those are device
   cosmetics with no content in them — see lib/cookieConsent.ts's audited
   PREFERENCE_KEYS list, which is the authoritative inventory of what this app
   writes to localStorage and why. Wiping a founder's dark-mode preference
   every time a second person borrows their laptop would cost real annoyance
   for zero privacy benefit.
--------------------------------------------------------------------------- */

const LAST_USER_ID_KEY = 've_last_user_id';

// This guard didn't exist before it shipped, which means "no ve_last_user_id
// recorded yet" is ambiguous: it's the ordinary case for a genuinely fresh
// browser, but it's ALSO exactly the state of a browser that had already been
// used by more than one account before this fix went out — content is
// already mixed together in localStorage right now, and the normal "nothing
// to compare against, do nothing" path below would leave it there forever,
// because by the time any two DIFFERENT accounts load the app post-fix, the
// first one to load already "claims" whatever was sitting in storage as its
// own. MIGRATION_KEY forces exactly one unconditional purge, the first time
// this code ever runs in a given browser, before the normal switch-detection
// logic takes over. Runs once ever per browser, not once per switch.
const MIGRATION_KEY = 've_account_isolation_migrated';

// Keys that hold real content or business context rather than device
// cosmetics. ve_gate_* is handled separately via resetGate() so this list and
// enterpriseGate.ts's own key names never have to be kept in sync by hand.
const CONTENT_KEYS = [
  've_chat_sessions',
  've_open_chat',
  've_saved_analyses',
  've_privacy_consent',
  // A cache of fetched company reports (see lib/cookieConsent.ts's
  // PREFERENCE_KEYS) — optional and rebuildable, but it is fetched CONTENT,
  // not a UI setting, so it belongs on this list rather than that one.
  've_company_reports',
  've_cc_hidden',
  've_today_seen',
];
const CONTENT_PREFIXES = ['ve_outcome_reminder_seen_'];

function clearContentKeys(): void {
  try {
    for (const key of CONTENT_KEYS) localStorage.removeItem(key);

    // Collect first, delete after — removing during iteration over
    // localStorage's live index skips entries (same caveat as
    // cookieConsent.ts's purgePreferenceStorage).
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && CONTENT_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, storage disabled) — nothing was
    // ever written, so there is nothing here to leak.
  }
  resetGate();
}

/**
 * Call once, synchronously, as soon as a Clerk userId is known and BEFORE any
 * protected page renders — see App.tsx's RequireAuth, which every protected
 * route passes through and which calls this before returning its children.
 * Doing it there rather than in a useEffect matters: an effect runs after the
 * page has already committed once, which is one render too late for a page
 * that reads localStorage synchronously on mount (e.g. Venus.tsx's
 * getSessions()).
 *
 * Returns true exactly when it purged (i.e. this really is a different
 * account from whoever used this browser last), so the caller can also drop
 * the React Query cache — a network response fetched under the previous
 * account's auth token is exactly as cross-account as anything in
 * localStorage, and would otherwise flash on screen until it happens to
 * refetch.
 */
export function guardAccountIdentity(userId: string | null | undefined): boolean {
  if (!userId) return false;

  let lastUserId: string | null;
  let migrated: string | null;
  try {
    lastUserId = localStorage.getItem(LAST_USER_ID_KEY);
    migrated = localStorage.getItem(MIGRATION_KEY);
  } catch {
    return false;
  }

  // See MIGRATION_KEY above — this must run before the ordinary comparison
  // below, and unconditionally, precisely because a browser already
  // contaminated pre-fix looks identical to a brand new one from here.
  if (!migrated) {
    clearContentKeys();
    try {
      localStorage.setItem(MIGRATION_KEY, '1');
      localStorage.setItem(LAST_USER_ID_KEY, userId);
    } catch {}
    return true;
  }

  if (lastUserId === userId) return false;

  const switchedAccount = lastUserId !== null;
  if (switchedAccount) clearContentKeys();

  try {
    localStorage.setItem(LAST_USER_ID_KEY, userId);
  } catch {}

  return switchedAccount;
}
