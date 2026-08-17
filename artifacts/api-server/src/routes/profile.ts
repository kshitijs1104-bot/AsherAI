import { Router } from "express";
import { z } from "zod/v4";
import { clerkClient, getAuth } from "@clerk/express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { recordAuditEvent } from "../lib/auditLog";
import { describeDbError } from "../lib/dbErrors";

/* ---------------------------------------------------------------------------
   WHO THIS FOUNDER IS — the one place identity is assembled.

   Serves two screens that were both previously broken in the same way:

     THE ONBOARDING FORM asked five questions (company, revenue, team size,
     role, how they heard about Vera) and wrote every answer to localStorage
     and nowhere else. Five questions asked of every single user, producing no
     analysable data at all — you could not have answered "which channel is
     working" or "what stage are our users at" from anything the product held.

     THE ACCOUNT SCREEN did not exist. There was no way for a founder to see
     what Vera had recorded about them, and no way to correct it.

   IDENTITY IS ASSEMBLED FROM TWO SOURCES, deliberately, and neither is
   authoritative for the other:

     Clerk owns the ACCOUNT — email, when they joined, the avatar. This server
     never stores those; it reads them per request. Copying them into Postgres
     would create a second copy that goes stale the moment somebody changes
     their email at Clerk, and a stale email on an account screen is worse than
     no email at all.

     Vera owns the BUSINESS CONTEXT — company, role, revenue, team size. That
     is Vera's own knowledge about the founder, it is what the model reasons
     from, and it belongs beside the rest of the founder's data.

   `displayName` is the one field that can shadow Clerk: null means "use the
   Clerk name", which is the default and the common case.
--------------------------------------------------------------------------- */

const router = Router();

// Shared by getOrCreate below and the onboarding write. Mirrors the pattern in
// routes/settings.ts (insert, onConflictDoNothing, re-select) because two
// concurrent requests for a brand-new account can otherwise race and violate
// the sessionId unique constraint.
async function getOrCreateSettings(userId: string) {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, userId)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(settingsTable)
    .values({ sessionId: userId })
    .onConflictDoNothing({ target: settingsTable.sessionId })
    .returning();
  if (created) return created;

  const [fallback] = await db.select().from(settingsTable).where(eq(settingsTable.sessionId, userId)).limit(1);
  return fallback;
}

/** Never throws. A Clerk outage should degrade the account card to the fields
 *  Vera itself holds, not fail the whole screen. */
async function clerkIdentity(userId: string) {
  try {
    const user = await clerkClient.users.getUser(userId);
    return {
      email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null,
      clerkName: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      imageUrl: user.imageUrl ?? null,
      memberSince: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    };
  } catch {
    return { email: null, clerkName: null, imageUrl: null, memberSince: null };
  }
}

/* -------------------------------------------------------------------------
 * Read — backs the account ID card
 * ---------------------------------------------------------------------- */

router.get("/profile", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const [settings, identity] = await Promise.all([getOrCreateSettings(userId), clerkIdentity(userId)]);

    return res.json({
      userId,
      // Vera's name for them if they set one, otherwise Clerk's, otherwise
      // nothing — the UI decides how to present an absent name rather than
      // this route inventing a placeholder.
      name: settings?.displayName ?? identity.clerkName,
      displayName: settings?.displayName ?? null,
      clerkName: identity.clerkName,
      email: identity.email,
      imageUrl: identity.imageUrl,
      memberSince: identity.memberSince,
      company: settings?.companyName ?? null,
      role: settings?.role ?? null,
      teamSize: settings?.teamSize ?? null,
      monthlyRevenue: settings?.monthlyRevenue ?? null,
      referralSource: settings?.referralSource ?? null,
      primaryGoal: settings?.primaryGoal ?? null,
      stage: settings?.stage ?? null,
      industry: settings?.industry ?? null,
      country: settings?.country ?? null,
      onboardingCompleted: settings?.onboardingCompleted ?? false,
      onboardingCompletedAt: settings?.onboardingCompletedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Couldn't load your account details" });
  }
});

/* -------------------------------------------------------------------------
 * Edit — the account card's inline editing
 * ---------------------------------------------------------------------- */

// Every field optional and independently updatable, so the card can save one
// field at a time without the client having to send back a whole object it
// might have stale copies of. Bounded lengths because these are rendered
// straight back onto a screen and into the model's prompt.
//
// `.nullable()` on each is what lets a founder CLEAR a field. Without it,
// "" and undefined would be indistinguishable from "leave it alone" and there
// would be no way to remove a wrong answer — only to overwrite it.
const ProfilePatch = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  role: z.string().trim().max(80).nullable().optional(),
  teamSize: z.string().trim().max(40).nullable().optional(),
  monthlyRevenue: z.string().trim().max(40).nullable().optional(),
  primaryGoal: z.string().trim().max(300).nullable().optional(),
  stage: z.string().trim().max(60).nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
});

// An empty string from a cleared input means "remove this", the same as null.
// Doing that here rather than in the UI means every client gets the behaviour.
function normalise(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.length === 0 ? null : value;
}

router.patch("/profile", requireAuth, async (req, res) => {
  const body = ProfilePatch.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Some of those values were too long or the wrong shape." });
  }

  try {
    const userId = requireUserId(req);
    await getOrCreateSettings(userId);

    const patch = body.data;
    // Only the keys actually sent are written, so a partial save never blanks
    // a field the client didn't mention.
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ("displayName" in patch) update.displayName = normalise(patch.displayName);
    if ("company" in patch) update.companyName = normalise(patch.company);
    if ("role" in patch) update.role = normalise(patch.role);
    if ("teamSize" in patch) update.teamSize = normalise(patch.teamSize);
    if ("monthlyRevenue" in patch) update.monthlyRevenue = normalise(patch.monthlyRevenue);
    if ("primaryGoal" in patch) update.primaryGoal = normalise(patch.primaryGoal);
    if ("stage" in patch) update.stage = normalise(patch.stage);
    if ("industry" in patch) update.industry = normalise(patch.industry);
    if ("country" in patch) update.country = normalise(patch.country);

    await db.update(settingsTable).set(update).where(eq(settingsTable.sessionId, userId));

    // Audited without the values. WHICH fields a founder edited is useful when
    // reconstructing "why does Vera think my company is called that"; the
    // values themselves are business content and do not belong in a log an
    // operator reads (see the rules in lib/auditLog.ts).
    void recordAuditEvent({
      eventType: "account.profile_updated",
      userId,
      actorId: userId,
      route: "/profile",
      severity: "info",
      metadata: { fields: Object.keys(patch).join(",") },
    });

    const [settings, identity] = await Promise.all([getOrCreateSettings(userId), clerkIdentity(userId)]);
    return res.json({
      name: settings?.displayName ?? identity.clerkName,
      displayName: settings?.displayName ?? null,
      company: settings?.companyName ?? null,
      role: settings?.role ?? null,
      teamSize: settings?.teamSize ?? null,
      monthlyRevenue: settings?.monthlyRevenue ?? null,
      primaryGoal: settings?.primaryGoal ?? null,
      stage: settings?.stage ?? null,
      industry: settings?.industry ?? null,
      country: settings?.country ?? null,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: describeDbError(err) });
  }
});

/* -------------------------------------------------------------------------
 * Onboarding — the funnel's one write
 * ---------------------------------------------------------------------- */

// Matches what pages/enterprise/Onboarding.tsx actually asks for. companyName
// and role are required because the form requires them; the rest are optional
// because the form lets them through empty and rejecting here would strand a
// founder on a screen they already satisfied.
const OnboardingBody = z.object({
  companyName: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(80),
  teamSize: z.string().trim().max(40).optional(),
  monthlyRevenue: z.string().trim().max(40).optional(),
  referralSource: z.string().trim().max(80).optional(),
});

router.post("/profile/onboarding", requireAuth, async (req, res) => {
  const body = OnboardingBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Company name and your role are both needed." });
  }

  try {
    const userId = requireUserId(req);
    await getOrCreateSettings(userId);

    const now = new Date();
    await db
      .update(settingsTable)
      .set({
        companyName: body.data.companyName,
        role: body.data.role,
        teamSize: body.data.teamSize || null,
        monthlyRevenue: body.data.monthlyRevenue || null,
        referralSource: body.data.referralSource || null,
        onboardingCompleted: true,
        // Set once. Re-running onboarding (which the funnel allows if someone
        // navigates back) must not move the original completion date — that is
        // the field any "how fast did people convert" question reads.
        onboardingCompletedAt: now,
        updatedAt: now,
      })
      .where(eq(settingsTable.sessionId, userId));

    // The referral source is the single most useful thing in this form and the
    // whole reason it now reaches the server: it is the only signal in the
    // product that says which channel actually brings founders in. Recorded as
    // an event as well as a column so it shows up in the operator summary
    // alongside everything else, rather than needing its own query.
    void recordAuditEvent({
      eventType: "account.onboarding_completed",
      userId,
      actorId: userId,
      route: "/profile/onboarding",
      severity: "info",
      metadata: {
        referralSource: body.data.referralSource || "(not given)",
        role: body.data.role,
        teamSize: body.data.teamSize || "(not given)",
      },
    });

    return res.json({ ok: true, onboardingCompleted: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: describeDbError(err) });
  }
});

export default router;
