import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { dismissNudge, getNudgesFor, markNudgesShown } from "../lib/nudges";

const router = Router();

/* ---------------------------------------------------------------------------
   GET  /nudges   — what Vera should prompt this founder about right now
   POST /nudges/shown    — record that they were actually rendered
   POST /nudges/dismiss  — "stop asking me this"

   WHY SHOWING IS A SEPARATE CALL FROM READING. The obvious design is for GET
   to mark them shown as a side effect, and it is wrong: the client polls this
   in the background, and a tab left open would silently burn through both the
   three-hour cooldown and the six-show ceiling on nudges the founder never had
   on screen. By the time they looked, Vera would have given up on telling
   them. So GET is a pure read, and the client reports back when the nudges
   were genuinely put in front of a human.
--------------------------------------------------------------------------- */

router.get("/nudges", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const nudges = await getNudgesFor(userId);
    return res.json({ nudges, count: nudges.length });
  } catch (err) {
    req.log.error(err);
    // An empty list, not a 500. A failure to compute a prompt must never be
    // the thing that breaks the page it was going to appear on.
    return res.json({ nudges: [], count: 0 });
  }
});

const KindsBody = z.object({
  kinds: z.array(z.string().trim().min(1).max(64)).max(10),
});

router.post("/nudges/shown", requireAuth, async (req, res) => {
  const body = KindsBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid nudge kinds" });

  try {
    await markNudgesShown(requireUserId(req), body.data.kinds);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.json({ ok: false });
  }
});

const DismissBody = z.object({
  kind: z.string().trim().min(1).max(64),
});

router.post("/nudges/dismiss", requireAuth, async (req, res) => {
  const body = DismissBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid nudge kind" });

  try {
    await dismissNudge(requireUserId(req), body.data.kind);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Couldn't record that. Try again." });
  }
});

export default router;
