export type GateStage = 'signup' | 'onboarding' | 'plan' | 'complete';

const STAGE_KEY = 've_gate_stage';
const SIGNUP_KEY = 've_gate_signup';
const ONBOARDING_KEY = 've_gate_onboarding';

export interface SignupData {
  name: string;
  email: string;
  company: string;
}

export interface OnboardingData {
  companyName: string;
  revenue: string;
  headcount: string;
  role: string;
  referralSource: string;
}

export function getGateStage(): GateStage | null {
  try {
    return (localStorage.getItem(STAGE_KEY) as GateStage) || null;
  } catch {
    return null;
  }
}

export function setGateStage(stage: GateStage) {
  try {
    localStorage.setItem(STAGE_KEY, stage);
  } catch {}
}

export function getSignupData(): SignupData | null {
  try {
    const raw = localStorage.getItem(SIGNUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSignupData(data: SignupData) {
  try {
    localStorage.setItem(SIGNUP_KEY, JSON.stringify(data));
    setGateStage('onboarding');
  } catch {}
}

export function getOnboardingData(): OnboardingData | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveOnboardingData(data: OnboardingData) {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(data));
    setGateStage('plan');
  } catch {}
}

export function completeGate() {
  try {
    setGateStage('complete');
  } catch {}
}

export function resetGate() {
  try {
    localStorage.removeItem(STAGE_KEY);
    localStorage.removeItem(SIGNUP_KEY);
    localStorage.removeItem(ONBOARDING_KEY);
    localStorage.removeItem(SELECTED_TIER_KEY);
  } catch {}
}

const SELECTED_TIER_KEY = 've_gate_selected_tier';

/** Which paid tier Plan.tsx sent the founder to Checkout for. Null means "the free tier". */
export function getSelectedTier(): string | null {
  try {
    return localStorage.getItem(SELECTED_TIER_KEY);
  } catch {
    return null;
  }
}

export function setSelectedTier(tierKey: string | null) {
  try {
    if (tierKey) localStorage.setItem(SELECTED_TIER_KEY, tierKey);
    else localStorage.removeItem(SELECTED_TIER_KEY);
  } catch {}
}

export function isEnterpriseUnlocked(): boolean {
  return getGateStage() === 'complete';
}

/* ---------------------------------------------------------------------------
   Repairing a profile the server never received.

   THE BUG THIS FIXES. Onboarding writes twice: to localStorage (so the funnel
   can decide the next step without waiting on a round trip) and to the server
   (so Vera can actually reason from it, and so the account screen can show it).
   Nothing ever retried the second one. So a single failed write — the columns
   not yet migrated onto that environment being the real-world case — left the
   founder permanently in a state where they HAD completed onboarding, their
   answers were sitting in their own browser, and the server knew none of it:
   the account card read "Not set" for every field, and the "tell Vera who you
   are" prompt kept firing at somebody who had already answered it. Reported as
   exactly that.

   The fix is not more error handling at the write site — it is making the two
   copies converge on their own. This compares them on load and re-sends the
   local answers when the server has nothing, which is the same self-healing
   shape used for privacy consent (see lib/privacyConsent.ts's refreshFromServer)
   and for the same reason: a value that lives in two places needs a defined way
   to reconcile, or it will drift and stay drifted.

   ONE DIRECTION ONLY. Local fills in a missing server record; the server never
   overwrites local. Onboarding answers are only ever authored in one place, so
   there is no genuine conflict to resolve — the only question is whether the
   server heard about it.
--------------------------------------------------------------------------- */
export async function repairServerProfile(): Promise<'not-needed' | 'repaired' | 'failed'> {
  const local = getOnboardingData();
  // Nothing local to repair FROM. A founder who genuinely has not onboarded is
  // handled by the funnel, not here.
  if (!local?.companyName?.trim()) return 'not-needed';

  try {
    const current = await fetch('/api/profile').then((r) => (r.ok ? r.json() : null));
    // Server already has it — the common case, and the cheap exit.
    if (current?.company?.trim()) return 'not-needed';

    const response = await fetch('/api/profile/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: local.companyName.trim(),
        // The server requires a role. An older local record may predate the
        // field, so fall back to something honest rather than failing the
        // repair over a value the founder was never asked for.
        role: (local.role ?? '').trim() || 'Founder',
        teamSize: local.headcount?.trim() || undefined,
        monthlyRevenue: local.revenue?.trim() || undefined,
        referralSource: local.referralSource?.trim() || undefined,
      }),
    });

    if (!response.ok) {
      console.error('[enterpriseGate] profile repair rejected', response.status);
      return 'failed';
    }
    return 'repaired';
  } catch (err) {
    // Offline or the API is down. Silent by design: this runs on every load and
    // a founder who is simply offline should not see an error about a
    // background reconciliation they never asked for. It retries next load.
    console.error('[enterpriseGate] profile repair could not run', err);
    return 'failed';
  }
}

export function getNextGateRoute(): string {
  const stage = getGateStage();
  if (!stage || stage === 'signup') return '/enterprise/signup';
  if (stage === 'onboarding') return '/enterprise/onboarding';
  if (stage === 'plan') return '/enterprise/plan';
  if (stage === 'complete') return '/vera';
  return '/enterprise/signup';
}
