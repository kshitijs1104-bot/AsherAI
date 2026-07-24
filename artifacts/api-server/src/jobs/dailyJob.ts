import { CronExpressionParser } from "cron-parser";
import { db, pool, workflowsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runWorkflow } from "../lib/workflows/runners";
import { checkAutomationSuggestions } from "../lib/workflows/suggestions";
import { ensureMonthlyRecap, isLastDayOfMonth, currentPeriodMonth } from "../lib/recap";

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

  // Section 8 (Recap Ritual) placeholder — see lib/recap.ts. Only fires on
  // the actual last day of the month; "usersTouched" (this run's active
  // workflow owners) is a scope-limited stand-in for "every founder with
  // activity this month" since there's no users table to enumerate
  // directly yet. Full recap design/UI is intentionally deferred.
  let recapsGenerated = 0;
  const today = new Date();
  if (isLastDayOfMonth(today)) {
    const periodMonth = currentPeriodMonth(today);
    for (const userId of usersTouched) {
      try {
        if (await ensureMonthlyRecap(userId, periodMonth)) recapsGenerated++;
      } catch (err) {
        console.error(`[dailyJob] monthly recap generation failed for user ${userId}:`, err);
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
