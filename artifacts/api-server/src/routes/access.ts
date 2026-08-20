import { Router } from "express";
import { z } from "zod/v4";
import { clerkClient, getAuth } from "@clerk/express";
import { db, accessRequestsTable, settingsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { isOperator, requireAuth, requireOperator, requireUserId } from "../middlewares/auth";
import { recordAuditEvent } from "../lib/auditLog";
import { logger } from "../lib/logger";

/* ---------------------------------------------------------------------------
   SIGNUP MODE — open by default, closable without a deploy.

   VERA_SIGNUP_MODE=waitlist turns the product into a waiting room: existing
   approved accounts carry on exactly as before, and anyone new is captured and
   told honestly where they stand instead of being let in or turned away.

   WHY NOT JUST USE CLERK'S RESTRICTED MODE. Clerk can block sign-up outright,
   which loses the person entirely — they hit a wall and you never learn they
   wanted in. During a period when you are deliberately limiting access, the
   people who show up anyway are the single most valuable list you could be
   building. This captures them.

   THE GATE IS DELIBERATELY NOT IN requireAuth. Access control for the whole API
   already lives there and is about IDENTITY (are you signed in, are you
   suspended). This is a product-stage question, checked once by the frontend at
   the point of entry, and enforcing it on every data route would mean an
   approved founder's requests each paying for an extra lookup to answer a
   question that changes once a month. A waitlisted person has an account and no
   data — there is nothing for them to reach.
--------------------------------------------------------------------------- */

const router = Router();

export type SignupMode = "open" | "waitlist";

function signupMode(): SignupMode {
  return /^(waitlist|closed)$/i.test(process.env.VERA_SIGNUP_MODE ?? "") ? "waitlist" : "open";
}

// Normalised at every write and read, so "Jane@Co.com" and "jane@co.com"
// cannot become two rows with two different answers.
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether this signed-in person may use the product.
 *
 * Open mode: everyone. Waitlist mode: an operator, or an approved row, or
 * anyone who signed up BEFORE the switch was flipped.
 *
 * ---- TWO CARVE-OUTS, BOTH OF WHICH WERE DESCRIBED HERE BEFORE THEY EXISTED ----
 *
 * OPERATORS ARE ALWAYS ALLOWED. Without this the product had a bootstrap
 * deadlock, and it is worth naming exactly because it is the kind that looks
 * like a broken deployment rather than a design gap. Flipping
 * VERA_SIGNUP_MODE=waitlist gates every signed-in account that has no approved
 * row — including the founder's own. The screen that grants the first approval
 * (/enterprise/access) lives behind that same gate, so the one person able to
 * let anybody in was shown the waiting room instead, and the only way out was
 * a hand-written SQL INSERT or a fetch() in devtools. That is precisely the
 * situation the Access Requests page was built to remove, so the page must not
 * be reachable only by people who do not need it.
 *
 * Operator status is read from OPERATOR_USER_IDS — an environment allowlist
 * that nothing inside the application can write to (see middlewares/auth.ts) —
 * so this carve-out cannot be granted by a database row, which is what makes
 * it safe to be unconditional.
 *
 * ALREADY-ONBOARDED ACCOUNTS ARE ALLOWED. The comment on this handler has
 * always claimed that existing founders keep working when the switch is
 * flipped. It was never implemented: the code checked only for an approved
 * row, so turning on waitlist mode locked out every founder already using
 * Vera — the exact opposite of what the switch is for, and indistinguishable
 * from the product breaking. `settings.onboardingCompleted` is the signal,
 * because it is the one flag that is only ever set by having actually gone
 * through the funnel.
 */
router.get("/access/me", requireAuth, async (req, res) => {
  const mode = signupMode();
  const operator = isOperator(getAuth(req)?.userId);

  if (mode === "open") {
    return res.json({ mode, allowed: true, status: "open", operator });
  }

  // Before any lookup that can fail: an operator locked out by a database
  // problem cannot fix the database problem through this product either.
  if (operator) {
    return res.json({ mode, allowed: true, status: "operator", operator });
  }

  try {
    const userId = requireUserId(req);
    const user = await clerkClient.users.getUser(userId).catch(() => null);
    const email = normaliseEmail(
      user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "",
    );

    if (!email) {
      // No address to match on. Fails OPEN: a founder with an unusual Clerk
      // configuration must not be locked out of a product they may already be
      // paying attention to, over a gate that exists to slow growth.
      logger.warn({ userId }, "Access check found no email on the Clerk account — allowing");
      return res.json({ mode, allowed: true, status: "no-email", operator, email: null });
    }

    const [row] = await db
      .select()
      .from(accessRequestsTable)
      .where(eq(accessRequestsTable.email, email))
      .limit(1);

    // The grandfather clause. Checked BEFORE `declined` so that flipping the
    // switch can never retroactively evict somebody who was already working in
    // Vera — an existing founder is a decision already made, and a waitlist is
    // for people who have not been decided on yet. Declining an existing
    // account is still possible, it is just done by suspending it
    // (/operator/users/:id/suspend), which is the control that actually stops
    // them using the API rather than one that only hides the front door.
    if (row?.status !== "approved") {
      // `sessionId` is the Clerk user id despite the name — the column predates
      // real identity and every other caller (routes/profile.ts) keys off it
      // the same way. Matched here rather than renamed, because a rename is a
      // migration and this is a bug fix.
      const [existing] = await db
        .select({ onboarded: settingsTable.onboardingCompleted })
        .from(settingsTable)
        .where(eq(settingsTable.sessionId, userId))
        .limit(1);

      if (existing?.onboarded) {
        return res.json({ mode, allowed: true, status: "existing", operator, email });
      }
    }

    if (row?.status === "approved") {
      // Record the first actual sign-in against the approval, so the operator
      // can tell "approved and using it" from "approved and never came back".
      if (!row.claimedAt) {
        await db
          .update(accessRequestsTable)
          .set({ claimedAt: new Date() })
          .where(eq(accessRequestsTable.id, row.id))
          .catch(() => {});
      }
      return res.json({ mode, allowed: true, status: "approved", operator, email });
    }

    if (row?.status === "declined") {
      return res.json({ mode, allowed: false, status: "declined", operator, email });
    }

    // No row yet — capture the request rather than just refusing. This is the
    // whole reason the waitlist is a table and not a Clerk setting.
    if (!row) {
      await db
        .insert(accessRequestsTable)
        .values({
          email,
          name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
        })
        .onConflictDoNothing({ target: accessRequestsTable.email })
        .catch((err) => logger.error({ err, userId }, "Could not record an access request"));

      void recordAuditEvent({
        eventType: "access.requested",
        userId,
        actorId: userId,
        route: "/access/me",
        severity: "info",
      });
    }

    return res.json({ mode, allowed: false, status: "pending", operator, email });
  } catch (err) {
    req.log.error(err);
    // Fails OPEN, same reasoning as above — a broken gate must not be an
    // outage for people who already have access.
    return res.json({ mode, allowed: true, status: "check-failed", operator });
  }
});

/* -------------------------------------------------------------------------
 * Operator: read and decide
 * ---------------------------------------------------------------------- */

router.get("/operator/access-requests", requireAuth, requireOperator, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const rows = await db
      .select()
      .from(accessRequestsTable)
      .where(status ? eq(accessRequestsTable.status, status) : sql`true`)
      .orderBy(desc(accessRequestsTable.createdAt))
      .limit(200);

    return res.json({
      mode: signupMode(),
      requests: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        company: r.company,
        status: r.status,
        requestedAt: r.createdAt,
        decidedAt: r.decidedAt,
        claimedAt: r.claimedAt,
      })),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not load access requests" });
  }
});

const DecisionBody = z.object({
  email: z.string().trim().email().max(200),
  decision: z.enum(["approve", "decline"]),
});

router.post("/operator/access-requests/decide", requireAuth, requireOperator, async (req, res) => {
  const body = DecisionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "An email and a decision (approve/decline) are required." });

  try {
    const actorId = requireUserId(req);
    const email = normaliseEmail(body.data.email);
    const status = body.data.decision === "approve" ? "approved" : "declined";
    const now = new Date();

    // Upsert, so an operator can pre-approve somebody who has not asked yet —
    // which is how you let a specific person in without making them queue.
    await db
      .insert(accessRequestsTable)
      .values({ email, status, decidedBy: actorId, decidedAt: now })
      .onConflictDoUpdate({
        target: accessRequestsTable.email,
        set: { status, decidedBy: actorId, decidedAt: now },
      });

    await recordAuditEvent({
      eventType: status === "approved" ? "access.approved" : "access.declined",
      actorId,
      route: "/operator/access-requests/decide",
      severity: "warn",
      metadata: { email },
    });

    return res.json({ ok: true, email, status });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not record that decision" });
  }
});

export default router;
