import Stripe from "stripe";
import { logger } from "./logger";

/* ---------------------------------------------------------------------------
   Billing, off by default.

   THE RULE THIS FOLLOWS, same one Checkout.tsx's deleted card form broke:
   card entry belongs to Stripe's own hosted page, never to this app's DOM,
   and a displayed price must be read off Stripe's own record, never a number
   living in a bundle or an env label a human can forget to update. Every
   function here exists to make that easy to keep true, not just true today.

   WHY TWO SWITCHES AND NOT ONE. STRIPE_SECRET_KEY configures the SDK client;
   BILLING_ENABLED is the product decision to actually show paid tiers and
   accept checkouts. Keeping them separate means a founder can set up Stripe
   keys, verify /billing/plans resolves real prices, and test a checkout in
   Stripe's own test mode — all before a single real user sees a price. Per
   the beta plan, BILLING_ENABLED stays off for existing free users until the
   30-day beta window is a decision someone actually makes, not a side effect
   of an env var being present.
--------------------------------------------------------------------------- */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY?.trim() ?? "";

export const stripe: Stripe | null = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" })
  : null;

if (!stripe) {
  logger.warn("STRIPE_SECRET_KEY is not set — billing is disabled; the product runs as free-only.");
}

/** True only when Stripe is configured AND the product decision to sell is on. */
export function billingEnabled(): boolean {
  return stripe !== null && /^(1|true|on|yes)$/i.test(process.env.BILLING_ENABLED ?? "");
}

export interface PlanTier {
  /** Internal key, also what the checkout endpoint expects in its request body. */
  key: string;
  name: string;
  priceId: string;
  /** In the currency's smallest unit (paise for inr), straight from Stripe — never typed by hand. */
  amount: number;
  currency: string;
  interval: string;
}

const TIER_ENV: { key: string; name: string; envVar: string }[] = [
  { key: "pro", name: "Pro", envVar: "STRIPE_PRICE_PRO" },
  { key: "max", name: "Max", envVar: "STRIPE_PRICE_MAX" },
];

// Resolved once per boot and cached, same reasoning as REQUIRED_ENV in app.ts:
// a price id that does not exist at Stripe should be found at startup, in the
// log, not the first time a founder clicks "Upgrade" during a demo.
let cachedTiers: PlanTier[] | null = null;

/** The real, live tiers — amounts read from Stripe's own Price objects, never from a constant. */
export async function getPlanCatalog(): Promise<PlanTier[]> {
  if (!stripe) return [];
  if (cachedTiers) return cachedTiers;

  const tiers: PlanTier[] = [];
  for (const tier of TIER_ENV) {
    const priceId = process.env[tier.envVar]?.trim();
    if (!priceId) continue;
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active || price.unit_amount === null) continue;
      tiers.push({
        key: tier.key,
        name: tier.name,
        priceId: price.id,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? "month",
      });
    } catch (err) {
      logger.error({ err, envVar: tier.envVar }, "Configured Stripe price id could not be read — omitting that tier");
    }
  }

  cachedTiers = tiers;
  return tiers;
}

export function findPriceId(tierKey: string, tiers: PlanTier[]): string | null {
  return tiers.find((t) => t.key === tierKey)?.priceId ?? null;
}
