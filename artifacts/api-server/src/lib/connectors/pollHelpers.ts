import { db, connectorsTable, type Connector } from "@workspace/db";
import { eq } from "drizzle-orm";

// Every poller (gmail.ts, calendar.ts, sheets.ts, slack.ts, notion.ts,
// jira.ts) wraps its actual work in this — same connected/error status
// bookkeeping repeated identically across all of them, pulled out once so
// each poller file is just "how do I talk to this one service."
export async function runPoll(connector: Connector, fn: () => Promise<number>): Promise<number> {
  try {
    const created = await fn();
    await db
      .update(connectorsTable)
      .set({ status: "connected", lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(connectorsTable.id, connector.id));
    return created;
  } catch (err) {
    await db
      .update(connectorsTable)
      .set({ status: "error", lastError: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
      .where(eq(connectorsTable.id, connector.id));
    throw err;
  }
}
