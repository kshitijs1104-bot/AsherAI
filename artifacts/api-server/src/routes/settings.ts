import { Router } from "express";
import { z } from "zod/v4";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SaveOnboardingBody } from "@workspace/api-zod";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

// Previously `(req.headers["x-session-id"] as string) || req.ip || "default"`
// — same IP-fallback bug as ai.ts. Settings (onboarding data, primaryGoal,
// the Groq key) is exactly the kind of per-person state that must never leak
// across users sharing a network, so every route below is now behind
// requireAuth and keyed on the verified Clerk userId.
function getSessionId(req: any): string {
  return requireUserId(req);
}

async function getOrCreateSettings(sessionId: string) {
  const [existing] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.sessionId, sessionId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(settingsTable)
    .values({ sessionId })
    .onConflictDoNothing({ target: settingsTable.sessionId })
    .returning();

  if (created) return created;

  const [fallback] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.sessionId, sessionId))
    .limit(1);

  return fallback;
}

// REMOVED: GET/POST/DELETE /settings/groq-key.
//
// These let a founder store their own Groq API key, which was then preferred
// over the server's when making inference calls. Two problems, either one
// sufficient on its own: the key was written to settings.groq_api_key in
// plaintext — a real credential sitting unencrypted beside business data, in
// a schema where the one other credential (connectors.oauthTokenRef) is
// AES-256-GCM encrypted precisely because it is one — and no screen in the
// product had called these endpoints in some time, so the storage existed
// without the feature.
//
// Inference now always uses the server's GROQ_API_KEY (see lib/groq.ts).
// The column itself is dropped in lib/db/src/schema/settings.ts.

/* ---------------------------------------------------------------------------
   Privacy consent, recorded server-side.

   THE GAP THIS CLOSES. The consent gate behaved correctly — it blocked the whole
   product until accepted and re-prompted everyone when PRIVACY_POLICY_VERSION
   changed — but the only record lived in the browser's localStorage. That is a
   value on the user's own device, on a clock they control, which they can clear.
   It made the screen work; it was not evidence that anyone agreed to anything,
   which is the entire purpose of recording consent.

   TWO DELIBERATE CHOICES:

   The VERSION is stored, not a boolean. "Accepted" is only meaningful paired
   with what was accepted — a boolean would leave everyone marked as having
   agreed to wording they never saw the moment the policy is revised.

   The TIMESTAMP is the server's, not the client's. A consent record whose date
   comes from the agreeing party's own clock is worth very little; this is the
   one field where the browser's value should not be trusted, so the request
   does not even carry one.
--------------------------------------------------------------------------- */

const AcceptPolicyBody = z.object({
  // Bounded and pattern-checked rather than free text: this is written to a
  // durable record, and the only legitimate values are the version strings the
  // frontend ships (e.g. "2026-08-15-r8").
  version: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w.-]+$/, "version must be a plain version string"),
});

router.post("/settings/privacy-consent", requireAuth, async (req, res) => {
  const body = AcceptPolicyBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "A policy version is required" });

  try {
    const userId = getSessionId(req);
    await getOrCreateSettings(userId);

    const acceptedAt = new Date();
    await db
      .update(settingsTable)
      .set({ policyVersion: body.data.version, policyAcceptedAt: acceptedAt, updatedAt: acceptedAt })
      .where(eq(settingsTable.sessionId, userId));

    // Audited as well as stored. The settings row answers "what did they accept";
    // the event answers "when, and in what order relative to everything else" —
    // which is the form the question takes if consent is ever disputed.
    void recordAuditEvent({
      eventType: "account.policy_accepted",
      userId,
      actorId: userId,
      route: "/settings/privacy-consent",
      severity: "info",
      metadata: { version: body.data.version },
    });

    return res.json({ version: body.data.version, acceptedAt: acceptedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not record your acceptance" });
  }
});

// Read back, so the gate can trust the server rather than the device. Returns
// null when nothing has been recorded — the client treats that as "not accepted"
// and shows the screen, which is the right direction for this to fail in.
router.get("/settings/privacy-consent", requireAuth, async (req, res) => {
  try {
    const userId = getSessionId(req);
    const settings = await getOrCreateSettings(userId);
    return res.json({
      version: settings?.policyVersion ?? null,
      acceptedAt: settings?.policyAcceptedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not read your consent record" });
  }
});

router.get("/settings/onboarding", requireAuth, async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const settings = await getOrCreateSettings(sessionId);

    return res.json({
      companyName: settings.companyName,
      stage: settings.stage,
      industry: settings.industry,
      teamSize: settings.teamSize,
      country: settings.country,
      primaryGoal: settings.primaryGoal,
      completed: settings.onboardingCompleted,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to get onboarding" });
  }
});

router.post("/settings/onboarding", requireAuth, async (req, res) => {
  try {
    const body = SaveOnboardingBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid onboarding data" });

    const sessionId = getSessionId(req);
    await getOrCreateSettings(sessionId);

    await db
      .update(settingsTable)
      .set({
        companyName: body.data.companyName,
        stage: body.data.stage,
        industry: body.data.industry,
        teamSize: body.data.teamSize,
        country: body.data.country,
        primaryGoal: body.data.primaryGoal,
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(settingsTable.sessionId, sessionId));

    return res.json({
      companyName: body.data.companyName,
      stage: body.data.stage,
      industry: body.data.industry,
      teamSize: body.data.teamSize,
      country: body.data.country,
      primaryGoal: body.data.primaryGoal,
      completed: true,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to save onboarding" });
  }
});

export default router;
