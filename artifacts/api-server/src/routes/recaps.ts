import { Router } from "express";
import { db, monthlyRecapsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";

const router = Router();

// Section 8 placeholder — no shareable-image/PDF rendering yet (explicitly
// deferred, see lib/recap.ts), just a plain read of whatever the monthly
// cron job (see jobs/dailyJob.ts) has generated so far. Private by
// default: scoped to the requesting founder's own userId, like every other
// table here — nothing about a recap is ever shown across users.
router.get("/recaps/latest", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const [recap] = await db
      .select()
      .from(monthlyRecapsTable)
      .where(eq(monthlyRecapsTable.userId, userId))
      .orderBy(desc(monthlyRecapsTable.periodMonth))
      .limit(1);
    return res.json({ recap: recap ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load recap" });
  }
});

export default router;
