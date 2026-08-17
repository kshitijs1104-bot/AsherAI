import { useEffect, lazy, Suspense, type ReactNode } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, RedirectToSignIn, RedirectToSignUp, useAuth } from "@clerk/clerk-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { VenusPage } from "@/pages/Venus";
import { WorkflowsPage } from "@/pages/Workflows";
import { DossierPage } from "@/pages/Dossier";
import { GoalsOverview } from "@/pages/GoalsOverview";
import { DecisionsOverview } from "@/pages/DecisionsOverview";
import { SettingsPage } from "@/pages/Settings";
import { SkinPicker } from "@/pages/SkinPicker";
import { LandingPage } from "@/pages/landing/Landing";
// ---- The design prototype is a DEVELOPMENT-ONLY surface ----
//
// It renders entirely from fixtures in src/prototype/data.ts and makes no API
// calls, so it exposes no founder data. What it does expose is the product:
// unshipped screens, planned features and the shape of how Vera works, on a
// public URL that needed no account to reach. For a product in closed beta
// that is the wrong thing to hand to anyone who guesses the path.
//
// This is a lazy dynamic import behind import.meta.env.DEV rather than a
// static one, and the difference is load-bearing. `vite build` replaces
// import.meta.env.DEV with the literal `false`, so the ternary folds to null
// and the import() below becomes unreachable — Rollup then drops the entire
// src/prototype subtree from the production bundle.
//
// A static `import { VeraPrototype } from "@/prototype"` did NOT achieve that,
// which is why it was changed: guarding only the <Route> removed the
// components (verified — CausalTrace and its helpers left the bundle) but
// src/prototype/theme.ts survived tree-shaking and shipped its palette tokens
// to production anyway. Not a leak of consequence on its own, but it meant
// "the prototype isn't in the build" was not actually true. Now it is.
const VeraPrototype = import.meta.env.DEV
  ? lazy(() => import("@/prototype").then((m) => ({ default: m.VeraPrototype })))
  : null;
import { OnboardingGate } from "@/pages/enterprise/Onboarding";
import { PlanGate } from "@/pages/enterprise/Plan";
import { CheckoutGate } from "@/pages/enterprise/Checkout";
import { PrivacyGate } from "@/pages/legal/PrivacyGate";
import { PrivacyPolicyPage } from "@/pages/legal/PrivacyPolicyPage";
import { CookieBanner } from "@/pages/legal/CookieBanner";
import { usePrivacyAccepted, refreshFromServer } from "@/lib/privacyConsent";

const queryClient = new QueryClient();

// Narrowed via a local const rather than read straight off import.meta.env at
// the usage site: TypeScript does not carry the `throw` guard below through to
// a separate module-level binding read later in JSX, so `publishableKey` was a
// `string | undefined` type error — one of the two errors that made
// `pnpm run build` (which gates on typecheck) fail on main.
const rawClerkKey = import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"] as string | undefined;

if (!rawClerkKey) {
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY is not set. Add it in Replit Secrets — see .env.example.",
  );
}

const CLERK_PUBLISHABLE_KEY: string = rawClerkKey;

// Registers Clerk's getToken() as the bearer-token source for every request
// made through the generated api-client-react hooks (useVenusAnalyze, etc).
// This is the other half of closing the identity gap: App-level ClerkProvider
// gives the browser a session, but nothing previously read that session and
// attached it to outgoing fetches — Venus.tsx made unauthenticated calls with
// no Authorization header at all, which is exactly why the backend fell back
// to req.ip. Mounted once, inside ClerkProvider, before any route renders.
function AuthTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return null;
}

// Shown only while Clerk is still resolving whether there is a session. This
// state has to render SOMETHING deliberate: the previous <SignedIn>/<SignedOut>
// pair rendered neither branch until Clerk loaded, so a deep link flashed a
// blank page before redirecting. It also has to render something that is NOT
// the requested page — the whole point is that no protected UI mounts until
// the answer is known.
function AuthPending() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)] text-[var(--muted)]"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm">Checking your session…</span>
    </div>
  );
}

// The full path Clerk should return the visitor to once they finish signing
// in. Read off window.location rather than wouter's useLocation() because
// wouter reports the path with the router base stripped, and Clerk needs the
// real browser path — otherwise a deployment served under a sub-path sends
// people back to the wrong URL.
function currentPath(): string {
  return window.location.pathname + window.location.search;
}

// ---- The only thing standing between a pasted URL and the app ----
//
// Renders `children` ONLY for a visitor with a verified Clerk session. There
// are three states, and each is handled explicitly:
//
//   still loading  -> AuthPending. Never children.
//   signed out     -> bounce to Clerk, remembering where they were headed.
//   signed in      -> the page.
//
// useAuth() is used instead of the <SignedIn>/<SignedOut> component pair
// specifically so the loading state is its own branch. With that pair, "not
// loaded yet" and "signed out" are indistinguishable from the outside — both
// simply render nothing — which makes it impossible to tell a slow session
// check apart from a failed one, and produces the blank flash described above.
//
// signInFallbackRedirectUrl / signUpFallbackRedirectUrl carry the originally
// requested path through the round trip, so pasting a link to a deep page and
// signing in lands on that page rather than dumping the visitor at the root.
// Both are set because a visitor with no account will switch to the sign-up
// tab on Clerk's screen, and should be returned to the same place afterwards.
function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <AuthPending />;

  if (!isSignedIn) {
    const returnTo = currentPath();
    return <RedirectToSignIn signInFallbackRedirectUrl={returnTo} signUpFallbackRedirectUrl={returnTo} />;
  }

  return <RequireConsent>{children}</RequireConsent>;
}

// ---- Consent is a condition on the product, not a step in the funnel ----
//
// This sits INSIDE RequireAuth and wraps every protected route at once, which
// is deliberate. The obvious implementation — a /enterprise/privacy screen
// between Clerk and onboarding — would have covered the one path a brand new
// signup happens to take and nothing else: an existing account whose consent
// predates a policy change, a bookmarked deep link, a shared /vera/dossier URL
// and a typo'd path all reach the app without passing through the funnel.
//
// Here there is no such gap. Whatever a signed-in visitor asked for, they get
// the policy first and the product second. It renders in place of `children`
// rather than over the top of it, so no protected screen mounts, no data
// request fires, and nothing of the product is visible behind the text.
//
// Nothing navigates on acceptance: the gate writes the record, this re-renders,
// and the originally requested route appears underneath. Someone who signed up
// and landed here continues to onboarding; someone who pasted a link gets the
// link. Consent costs them their place in the queue, not their destination.
function RequireConsent({ children }: { children: ReactNode }) {
  const accepted = usePrivacyAccepted();

  // Reconcile with the server's record once per signed-in mount. The server row
  // is the consent record; localStorage is only a cache that keeps the first
  // paint off the network. This runs in BOTH directions — see
  // refreshFromServer — so a new device inherits an acceptance already given,
  // and a hand-edited local value cannot get anyone past the policy.
  //
  // Deliberately not awaited and not gated on: a founder who accepted a moment
  // ago should not be shown the screen again because a fetch is in flight, and
  // an API outage should not lock the product. If the server has no record, the
  // local claim is dropped and the gate renders on the next tick.
  useEffect(() => {
    void refreshFromServer();
  }, []);

  if (!accepted) return <PrivacyGate />;

  return <>{children}</>;
}

// Holds something back until the policy has been accepted. Needed for exactly
// one thing: the SkinPicker is mounted beside the router rather than inside it,
// so RequireConsent above does not cover it, and on a brand new account both
// would open at once — a dismissible "choose how Vera looks" dialog stacked on
// top of a consent screen that must not be dismissible. First-run order is now
// the policy, then the look.
function AfterConsent({ children }: { children: ReactNode }) {
  return usePrivacyAccepted() ? <>{children}</> : null;
}

// Shows the cookie banner everywhere EXCEPT underneath the privacy gate.
//
// `useAuth` rather than <SignedIn>/<SignedOut> because this needs all three
// states distinguished, not two: signed out (show — a visitor on the landing
// page can still set a preference), signed in and past the policy (show), and
// signed in but still facing PrivacyGate (withhold, so the two consent
// surfaces are never on screen together). While Clerk is still loading, the
// answer is "not yet" — a banner that flashes in and out during boot reads as
// a glitch, and one extra beat before asking costs nothing.
function CookieBannerHost() {
  const { isLoaded, isSignedIn } = useAuth();
  const privacyAccepted = usePrivacyAccepted();

  if (!isLoaded) return null;
  if (isSignedIn && !privacyAccepted) return null;

  return <CookieBanner />;
}

// /enterprise/signup used to render a form that took a name and an email,
// wrote them to localStorage, and moved the visitor to the next "gate". It
// created no account. Anyone could walk the whole four-step funnel without
// ever authenticating, arrive at a screen that said they were set up, and only
// then be stopped by Clerk on /vera — having been told they had signed up.
//
// Signing up now means signing up: a signed-out visitor goes to Clerk's real
// sign-up screen, and comes back to the onboarding step with an actual
// account behind them. Someone who already has an account has no "create your
// account" step to do, so they skip straight to onboarding.
function SignupEntry() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <AuthPending />;

  if (!isSignedIn) {
    return (
      <RedirectToSignUp
        signUpFallbackRedirectUrl="/enterprise/onboarding"
        signInFallbackRedirectUrl="/enterprise/onboarding"
      />
    );
  }

  return <Redirect to="/enterprise/onboarding" />;
}

// ---- Routing is DENY BY DEFAULT ----
//
// This used to be one flat list where every entry was public unless somebody
// remembered to wrap it in <AuthGate>. Protection was opt-in, so forgetting
// the wrapper on a new screen published it to the internet, and nothing in the
// file made that omission visible. That is the same failure the backend had
// with routes nobody removed — a default that has to be actively resisted.
//
// The shape below inverts it. Everything above the catch-all is a deliberate,
// enumerated public page. The catch-all matches every other path — including
// ones nobody has written yet, and including typos and 404s — and runs it
// through RequireAuth first. Adding a screen inside the inner <Switch> makes
// it protected automatically; making something public now takes an explicit
// edit above the line, which is exactly the direction the effort should run.
//
// A signed-out visitor pasting ANY link that is not in the public list — an
// old bookmark, a shared /vera/dossier URL, a guessed path, a misspelling —
// reaches Clerk, not a page. Their session is then verified server-side too:
// every data route requires a Clerk-issued token independently of anything
// decided here, so this gate governs what renders, never what is readable.
function Router() {
  return (
    <Switch>
      {/* ---------- PUBLIC. Add here only with intent. ---------- */}

      {/* The front door — a signed-out visitor is exactly who it is for. It
          carries its own nav and footer, so it sits outside any app chrome.
          "/landing" stays registered as an alias so older links keep working. */}
      <Route path="/" component={LandingPage} />
      <Route path="/landing" component={LandingPage} />

      {/* Dev-only; see the VeraPrototype import above. In a production build
          VeraPrototype is null and this branch does not exist. */}
      {VeraPrototype && (
        <Route path="/prototype">
          <Suspense fallback={null}>
            <VeraPrototype />
          </Suspense>
        </Route>
      )}

      {/* Public because it is the way IN, but it no longer renders a form of
          its own — it hands the visitor to Clerk's real sign-up. See
          SignupEntry. */}
      <Route path="/enterprise/signup" component={SignupEntry} />

      {/* The privacy policy, same text every account is shown and has to accept
          before it can use anything (see RequireConsent). Public on purpose: a
          policy you can only read after signing up is one you cannot read
          before deciding whether to sign up. */}
      <Route path="/privacy" component={PrivacyPolicyPage} />

      {/* ---------- EVERYTHING BELOW REQUIRES A VERIFIED SESSION ---------- */}
      <Route>
        <RequireAuth>
          <Switch>
            {/* The rest of the enterprise funnel. These are post-account steps,
                so they now sit behind auth: previously a signed-out visitor
                could walk onboarding -> plan -> checkout and be told they were
                set up without an account ever existing. */}
            <Route path="/enterprise/onboarding" component={OnboardingGate} />
            <Route path="/enterprise/plan" component={PlanGate} />
            <Route path="/enterprise/checkout" component={CheckoutGate} />

            {/* "/vera" is canonical; "/venus" is the old internal codename and
                stays registered so existing bookmarks and shared links resolve. */}
            <Route path="/vera" component={VenusPage} />
            <Route path="/vera/workflows" component={WorkflowsPage} />
            <Route path="/vera/dossier" component={DossierPage} />
            <Route path="/vera/goals" component={GoalsOverview} />
            <Route path="/vera/decisions" component={DecisionsOverview} />

            <Route path="/venus" component={VenusPage} />
            <Route path="/venus/workflows" component={WorkflowsPage} />
            <Route path="/venus/dossier" component={DossierPage} />
            <Route path="/venus/goals" component={GoalsOverview} />
            <Route path="/venus/decisions" component={DecisionsOverview} />

            {/* Bare-path aliases. Someone sharing a link is as likely to write
                /dossier as /vera/dossier, and landing on a 404 after signing in
                reads as "my account doesn't work". These resolve to the real
                page; the gate above has already run by this point. */}
            <Route path="/dossier"><Redirect to="/vera/dossier" /></Route>
            <Route path="/workflows"><Redirect to="/vera/workflows" /></Route>
            <Route path="/goals"><Redirect to="/vera/goals" /></Route>
            <Route path="/decisions"><Redirect to="/vera/decisions" /></Route>

            {/* Settings is Vera's own — the business context attached to every
                request, and the read-only company memory. */}
            <Route path="/settings" component={SettingsPage} />

            {/* Reached only by a signed-in user with a bad path. A signed-out
                one never gets here — RequireAuth sent them to Clerk. */}
            <Route component={NotFound} />
          </Switch>
        </RequireAuth>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    // telemetry is off because the privacy policy says, in section 19, that
    // there is no analytics on this site — and until this line existed that
    // was not quite true. Clerk's SDK ships usage telemetry ON by default; it
    // was running here, which is how `clerk_telemetry_throttler` turned up in
    // local storage during the cookie audit. It reports SDK usage rather than
    // anything about the founder, and it is not advertising, but it is still
    // a third party receiving data from this page for a purpose that serves
    // the user not at all — and a policy sentence that needs that much
    // qualification to stay true is a sentence that should just be made true.
    // Leave it disabled, or change section 19 in the same commit.
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} telemetry={{ disabled: true }}>
      <AuthTokenBridge />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* CategoryProvider used to wrap everything here. Its only consumers
              were the Topbar, the LeftSidebar, Line and Thoughts — all now in
              src/_archive — so it went with them. */}
          <>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            {/* Asks once, on first sign-in, which of the two visual systems to
                use — and never again once a choice is stored. Mounted here
                rather than inside a route so the choice is made before the
                founder starts working, and gated on SignedIn so it can't
                appear over the sign-in screen. Renders null when a skin has
                already been chosen, so this costs a mount and nothing else. */}
            <SignedIn>
              <AfterConsent>
                <SkinPicker />
              </AfterConsent>
            </SignedIn>
            {/* The cookie banner mounts here — and renders nothing today,
                because lib/cookieConsent.ts's CONSENT_REQUIRED is false and
                Vera has no storage that needs consent. Deliberately left
                mounted rather than deleted: flipping that one boolean is what
                turns it on, and a component that is wired but inert stays
                working, whereas one commented out here rots against every
                refactor until it no longer compiles on the day it is needed.
                CookieBannerHost also keeps it from ever stacking on top of
                PrivacyGate. Read the switch's comment before changing it. */}
            <CookieBannerHost />
            <Toaster />
          </>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
