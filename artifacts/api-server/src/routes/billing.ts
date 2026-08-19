import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { clerkClient } from "@clerk/express";
import { db, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { stripe, billingEnabled, getPlanCatalog, findPriceId } from "../lib/stripe";
import { recordAuditEvent } from "../lib/auditLog";
import { logger } from "../lib/logger";

const router = Router();

const FREE_BETA_DAYS = 30;

/* ---------------------------------------------------------------------------
   /billing — the paid-tier gate.

   OFF UNTIL SOMEONE DECIDES OTHERWISE. Every route here answers honestly with
   "billing isn't live" while STRIPE_SECRET_KEY or BILLING_ENABLED is unset —
   see lib/stripe.ts for why those are two separate switches. Per the beta
   plan, that is the correct state for existing free users; flipping
   BILLING_ENABLED on is a product decision, not a deploy step.

   WHAT NEVER HAPPENS HERE: a card number, a typed amount, or a client-chosen
   price. Every amount shown to a founder is read from Stripe's Price object
   (see getPlanCatalog); every checkout is a redirect to Stripe's own hosted
   page. Same reasoning as Checkout.tsx's header comment — read it before
   changing this file.
--------------------------------------------------------------------------- */

router.get("/billing/plans", requireAuth, async (_req, res) => {
  if (!billingEnabled()) {
    return res.json({ enabled: false, tiers: [] });
  }
  const tiers = await getPlanCatalog();
  return res.json({ enabled: tiers.length > 0, tiers });
});

/**
 * Where a founder stands: their stored plan, and — since the beta plan is
 * "free for the first 30 days, decide later" rather than an enforced cutoff —
 * how much of that window is left. NOTHING in this codebase blocks access
 * when the window closes; this endpoint only reports the number so a UI can
 * be built on it later, deliberately. See the PR notes for why enforcement is
 * not wired to requireAuth yet.
 */
router.get("/billing/status", requireAuth, async (req, res) => {
  const userId = requireUserId(req);

  try {
    const [row] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1);

    let betaDaysRemaining: number | null = null;
    try {
      const user = await clerkClient.users.getUser(userId);
      const createdAt = user.createdAt ? new Date(user.createdAt) : null;
      if (createdAt) {
        const elapsedDays = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
        betaDaysRemaining = Math.max(0, Math.ceil(FREE_BETA_DAYS - elapsedDays));
      }
    } catch (err) {
      logger.warn({ err, userId }, "Could not read Clerk account age for the beta window — omitting it");
    }

    return res.json({
      plan: row?.plan ?? "free",
      status: row?.status ?? null,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: row?.currentPeriodEnd ?? null,
      betaDaysRemaining,
    });
  } catch (err) {
    logger.error({ err, userId }, "Billing status lookup failed");
    return res.status(500).json({ error: "Could not load billing status" });
  }
});

const CheckoutBody = z.object({ tierKey: z.string().min(1).max(40) });

router.post("/billing/checkout", requireAuth, async (req, res) => {
  if (!billingEnabled() || !stripe) {
    return res.status(503).json({ error: "Billing isn't live yet." });
  }

  const body = CheckoutBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "A plan is required." });

  const userId = requireUserId(req);
  const frontendUrl = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  if (!frontendUrl) {
    logger.error("POST /billing/checkout called but FRONTEND_URL is not set — cannot build a return URL");
    return res.status(500).json({ error: "Checkout isn't configured correctly yet — missing a return address." });
  }

  try {
    const tiers = await getPlanCatalog();
    const priceId = findPriceId(body.data.tierKey, tiers);
    if (!priceId) return res.status(400).json({ error: "That plan isn't available." });

    // Reuse an existing Stripe customer for this user rather than minting a
    // new one on every checkout attempt — a founder who abandons checkout and
    // tries again should not accumulate duplicate customers with no
    // subscription behind them.
    const [existing] = await db
      .select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      customer: existing?.stripeCustomerId ?? undefined,
      customer_email: existing?.stripeCustomerId ? undefined : email,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      success_url: `${frontendUrl}/enterprise/checkout?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/enterprise/plan`,
    });

    void recordAuditEvent({
      eventType: "billing.checkout_started",
      userId,
      actorId: userId,
      severity: "info",
      metadata: { tierKey: body.data.tierKey },
    });

    if (!session.url) return res.status(502).json({ error: "Stripe did not return a checkout page." });
    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, userId }, "Stripe checkout session creation failed");
    return res.status(502).json({ error: "Couldn't start checkout just now — try again in a moment." });
  }
});

/* -------------------------------------------------------------------------
 * Webhook — mounted directly in app.ts with a raw body parser, BEFORE
 * express.json() and BEFORE the CSRF Origin check, because Stripe is a
 * server-to-server caller with neither a matching Origin nor a Bearer token.
 * The signature check below is what authenticates it instead — stronger than
 * either, since it proves the body came from Stripe and was not modified in
 * transit, not just that it arrived from an allowed origin.
 * ---------------------------------------------------------------------- */

async function upsertFromStripeSubscription(userId: string, sub: import("stripe").default.Subscription, tiers: Awaited<ReturnType<typeof getPlanCatalog>>) {
  const priceId = sub.items.data[0]?.price?.id;
  const matchedTier = tiers.find((t) => t.priceId === priceId);
  const periodEndSeconds = sub.items.data[0]?.current_period_end;

  await db
    .insert(subscriptionsTable)
    .values({
      userId,
      plan: sub.status === "canceled" ? "free" : (matchedTier?.key ?? "unknown"),
      status: sub.status,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId ?? null,
      currentPeriodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: subscriptionsTable.userId,
      set: {
        plan: sub.status === "canceled" ? "free" : (matchedTier?.key ?? "unknown"),
        status: sub.status,
        stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId ?? null,
        currentPeriodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });
}

export async function stripeWebhookHandler(req: Request, res: Response) {
  if (!stripe) return res.status(503).json({ error: "Billing isn't configured" });

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = req.headers["stripe-signature"];
  if (!secret || typeof signature !== "string") {
    logger.warn("Stripe webhook received with no signature or no STRIPE_WEBHOOK_SECRET configured — rejecting");
    return res.status(400).json({ error: "Missing signature" });
  }

  let event: import("stripe").default.Event;
  try {
    // req.body is a raw Buffer here — see the express.raw() mount in app.ts.
    // Verifying against the raw bytes is the whole point: re-serialised JSON
    // would not reproduce the exact bytes Stripe signed.
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    const tiers = await getPlanCatalog();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (userId && subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertFromStripeSubscription(userId, sub, tiers);
        void recordAuditEvent({ eventType: "billing.subscribed", userId, actorId: userId, severity: "warn" });
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) {
        await upsertFromStripeSubscription(userId, sub, tiers);
        void recordAuditEvent({
          eventType: event.type === "customer.subscription.deleted" ? "billing.canceled" : "billing.updated",
          userId,
          actorId: userId,
          severity: "warn",
          metadata: { status: sub.status },
        });
      }
    }

    return res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Stripe webhook handling failed");
    // 500 so Stripe retries — the event was valid, something on our side
    // failed, and Stripe's retry schedule is the recovery path.
    return res.status(500).json({ error: "Webhook handling failed" });
  }
}

export default router;
