import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SaveOnboardingBody } from "@workspace/api-zod";
import { requireAuth, requireUserId } from "../middlewares/auth";

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
