import { pgTable, serial, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---- The row that answers "is this account paid, and for what" ----
//
// WHY THIS EXISTS. Billing is Stripe Checkout end to end — Stripe holds the
// card, the invoice history and the payment method. This table is not a
// second ledger of that; it is the one thing Stripe cannot answer for us:
// which Vera account a given Stripe customer IS. `status` mirrors Stripe's
// own subscription status strings verbatim (active, trialing, past_due,
// canceled, incomplete, incomplete_expired, unpaid, paused) rather than
// inventing a parallel vocabulary, so a webhook payload maps onto a row with
// no translation layer to keep in sync or get wrong.
//
// ABSENCE OF A ROW MEANS FREE. Same convention as user_status: there is no
// users table, nobody is required to have a row here before they can use the
// product, and a table that had to be pre-populated per user would be a new
// way for the free tier to fail. Only an account that has ever started a
// checkout gets a row.
//
// ONE ROW PER USER, UPSERTED. A person has at most one active subscription in
// this product's plan model (no add-ons, no multi-seat), so the unique index
// on userId is what the webhook handler upserts against — it is what keeps a
// retried or out-of-order Stripe event from creating a second row instead of
// updating the one that exists.
export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** "free" | "pro" | "max" — which tier this row represents. */
    plan: text("plan").notNull().default("free"),
    /** Stripe's own subscription status string, verbatim. Null until a checkout has ever started. */
    status: text("status"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("subscriptions_user_id_idx").on(table.userId)],
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
