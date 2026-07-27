import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { getActiveCompanyFacts, addCompanyFact, deleteCompanyFact } from "../lib/companyMemory";
import { getOrCreateActiveProfile } from "../lib/businessProfiles";

const router = Router();

// Returns only active (non-superseded) facts, most recent first, which is
// the same "current ground truth" view buildContext-style prompt assembly
// would eventually consume.
router.get("/company-facts", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const facts = await getActiveCompanyFacts(userId, limit);
    return res.json({ facts });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load company facts" });
  }
});

const AddFactBody = z.object({
  factText: z.string().min(1),
  factType: z.string().optional(),
  sourceType: z.enum(["onboarding", "chat", "checkin", "decision", "manual"]),
});

// The first write path onto company_facts (previously read-only — see the
// GET handler above). Morning Check-In is the primary caller: a founder's
// free-text answer to "anything changed?" lands here with
// sourceType: "checkin", the enum value this table was already carrying
// around unused.
router.post("/company-facts", requireAuth, async (req, res) => {
  const body = AddFactBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "factText and sourceType are required" });

  try {
    const userId = requireUserId(req);
    // Scoped to whichever business is currently active (see
    // businessProfiles.ts) — without this, a Morning Check-In fact would be
    // saved with no profile at all and silently invisible to chat prompts,
    // which only pull facts for the founder's active profile.
    const activeProfile = await getOrCreateActiveProfile(userId);
    const fact = await addCompanyFact({ userId, ...body.data, profileId: activeProfile?.id ?? null });
    if (!fact) return res.status(500).json({ error: "Failed to save fact" });
    return res.status(201).json({ fact });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to save fact" });
  }
});

// The "delete" half of "What Vera has learned" (list view is the GET above)
// — soft-deletes via deletedAt (see companyMemory.deleteCompanyFact), scoped
// to the authed founder so nobody can delete another user's fact.
router.delete("/company-facts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid fact id" });

  try {
    const userId = requireUserId(req);
    const deleted = await deleteCompanyFact(userId, id);
    if (!deleted) return res.status(404).json({ error: "Fact not found" });
    return res.json({ deleted: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to delete fact" });
  }
});

export default router;
