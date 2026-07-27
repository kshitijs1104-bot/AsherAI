import { useEffect, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, useAuth } from "@clerk/clerk-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout/Layout";
import { CategoryProvider } from "@/lib/CategoryContext";
import { LinePage } from "@/pages/Line";
import { SightPage } from "@/pages/Sight";
import { CryptPage } from "@/pages/Crypt";
import { ThoughtsPage } from "@/pages/Thoughts";
import { VenusPage } from "@/pages/Venus";
import { WorkflowsPage } from "@/pages/Workflows";
import { GoalsOverview } from "@/pages/GoalsOverview";
import { DecisionsOverview } from "@/pages/DecisionsOverview";
import { SettingsPage } from "@/pages/Settings";
import { SignupGate } from "@/pages/enterprise/Signup";
import { OnboardingGate } from "@/pages/enterprise/Onboarding";
import { PlanGate } from "@/pages/enterprise/Plan";
import { CheckoutGate } from "@/pages/enterprise/Checkout";

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

// Venus previously had zero auth guard (no Layout wrapper, no gate of any
// kind — anyone with the URL could open it and its sessionId resolved to
// req.ip on the backend). This wraps it with real identity: signed-out users
// get redirected to sign-in, signed-in users get the page with a verified
// Clerk session token attached to every API call they make from here on.
// Shared by every /venus/* route (chat, goals list, decisions list) since
// they all read/write the same signed-in founder's data.
function AuthGate({ component: Component }: { component: ComponentType }) {
  return (
    <>
      <SignedIn>
        <Component />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/enterprise/signup" component={SignupGate} />
      <Route path="/enterprise/onboarding" component={OnboardingGate} />
      <Route path="/enterprise/plan" component={PlanGate} />
      <Route path="/enterprise/checkout" component={CheckoutGate} />
      <Route path="/">
        <Layout>
          <LinePage />
        </Layout>
      </Route>
      <Route path="/line">
        <Layout>
          <LinePage />
        </Layout>
      </Route>
      <Route path="/sight">
        <Layout>
          <SightPage />
        </Layout>
      </Route>
      <Route path="/crypt">
        <Layout>
          <CryptPage />
        </Layout>
      </Route>
      <Route path="/thoughts">
        <Layout>
          <ThoughtsPage />
        </Layout>
      </Route>
      {/* FIX: "/venus" is the internal codename, not the product name — it
          was leaking straight into the visible URL bar. "/vera" is now the
          canonical path every in-app navigation call points at (see
          enterpriseGate.ts, Topbar.tsx, Layout.tsx, etc.); the old /venus
          routes stay registered, rendering the exact same components, so
          any existing bookmark or shared link keeps working. */}
      <Route path="/vera">
        <AuthGate component={VenusPage} />
      </Route>
      <Route path="/vera/workflows">
        <AuthGate component={WorkflowsPage} />
      </Route>
      <Route path="/vera/goals">
        <AuthGate component={GoalsOverview} />
      </Route>
      <Route path="/vera/decisions">
        <AuthGate component={DecisionsOverview} />
      </Route>
      <Route path="/venus">
        <AuthGate component={VenusPage} />
      </Route>
      <Route path="/venus/workflows">
        <AuthGate component={WorkflowsPage} />
      </Route>
      <Route path="/venus/goals">
        <AuthGate component={GoalsOverview} />
      </Route>
      <Route path="/venus/decisions">
        <AuthGate component={DecisionsOverview} />
      </Route>
      <Route path="/settings">
        <Layout>
          <SettingsPage />
        </Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthTokenBridge />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <CategoryProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </CategoryProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
