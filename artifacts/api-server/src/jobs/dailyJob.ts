import { CronExpressionParser } from "cron-parser";
import { db, pool, workflowsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runWorkflow } from "../lib/workflows/runners";
import { checkAutomationSuggestions } from "../lib/workflows/suggestions";
import { isLastDayOfMonth, currentPeriodMonth } from "../lib/recap";
import { buildMonthlyWrap, persistMonthlyWrap } from "../lib/monthlyWrap";
import { getGroqClient } from "../lib/groq";

// THE background execution loop. Deliberately a standalone script, not a
// setInterval living inside the API process — this deployment's target is
// Replit "autoscale," which scales the web process to zero on no traffic,
// so anything relying on the web process staying warm would silently stop
// firing the moment nobody's actively using the app. This script has no
// Express server, no long-lived listener: it runs once, does its work, and
// exits — the actual "every day, even with zero users logged in" guarantee
// has to come from whatever invokes it (a Replit Scheduled Deployment
// running `tsx src/jobs/dailyJob.ts` on a cron, or any external scheduler
// pointed at this entrypoint). See replit.md/README for wiring that up —
// this file only needs to be correct to run, not concerned with when.
function isDue(cronExpr: string, lastRunAt: Date | null): boolean {
  const interval = CronExpressionParser.parse(cronExpr, { currentDate: lastRunAt ?? new Date(0) });
  return interval.next().toDate().getTime() <= Date.now();
}

async function main() {
  const startedAt = Date.now();
  const activeWorkflows = await db.select().from(workflowsTable).where(eq(workflowsTable.status, "active"));

  let due = 0;
  let ran = 0;
  let failed = 0;
  let itemsCreated = 0;
  const usersTouched = new Set<string>();

  for (const workflow of activeWorkflows) {
    usersTouched.add(workflow.userId);
    if (!isDue(workflow.scheduleCron, workflow.lastRunAt)) continue;
    due++;

    try {
      const created = await runWorkflow(workflow.userId, workflow);
      itemsCreated += created;
      ran++;
    } catch (err) {
      failed++;
      console.error(`[dailyJob] workflow ${workflow.id} (${workflow.templateId}) for user ${workflow.userId} failed:`, err);
    } finally {
      // Advance lastRunAt on failure too — a persistently broken workflow
      // (e.g. a revoked Gmail token) should wait for its normal cadence to
      // retry, not get hammered every time this job happens to run.
      await db.update(workflowsTable).set({ lastRunAt: new Date() }).where(eq(workflowsTable.id, workflow.id));
    }
  }

  for (const userId of usersTouched) {
    try {
      itemsCreated += await checkAutomationSuggestions(userId);
    } catch (err) {
      console.error(`[dailyJob] automation-suggestion check failed for user ${userId}:`, err);
    }
  }

  // The monthly wrap, frozen on the last day of the month. Was
  // ensureMonthlyRecap (five lifetime totals — see lib/recap.ts's own
  // "placeholder" comment); now buildMonthlyWrap, which is month-scoped and
  // compares against the previous month, and is the same builder /dossier/wrap
  // serves on read. One builder means the wrap a founder reads mid-month and
  // the wrap frozen at month end can never disagree.
  //
  // "usersTouched" (this run's active workflow owners) remains a scope-limited
  // stand-in for "every founder with activity this month" — there is still no
  // users table to enumerate. A founder with no workflows therefore gets their
  // wrap computed on read instead of pre-generated, which is why that route
  // computes rather than only reading.
  let recapsGenerated = 0;
  const today = new Date();
  if (isLastDayOfMonth(today)) {
    const periodMonth = currentPeriodMonth(today);
    for (const userId of usersTouched) {
      try {
        const groq = await getGroqClient(userId);
        const wrap = await buildMonthlyWrap(userId, periodMonth, groq);
        // A month with nothing in it gets no stored wrap — an empty wrap is
        // worse than none, and storing one would freeze the emptiness even
        // if the founder becomes active before month end on a later run.
        if (!wrap.hasSignal) continue;
        await persistMonthlyWrap(userId, wrap);
        recapsGenerated++;
      } catch (err) {
        console.error(`[dailyJob] monthly wrap generation failed for user ${userId}:`, err);
      }
    }
  }

  console.log(
    `[dailyJob] done in ${Date.now() - startedAt}ms — ${activeWorkflows.length} active workflows, ${due} due, ${ran} ran, ${failed} failed, ${itemsCreated} queue items created, ${recapsGenerated} monthly recaps generated`,
  );
}

main()
  .catch((err) => {
    console.error("[dailyJob] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
