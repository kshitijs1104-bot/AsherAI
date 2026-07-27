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
  } catch {}
}

export function isEnterpriseUnlocked(): boolean {
  return getGateStage() === 'complete';
}

export function getNextGateRoute(): string {
  const stage = getGateStage();
  if (!stage || stage === 'signup') return '/enterprise/signup';
  if (stage === 'onboarding') return '/enterprise/onboarding';
  if (stage === 'plan') return '/enterprise/plan';
  if (stage === 'complete') return '/vera';
  return '/enterprise/signup';
}
