import { db, connectorsTable, queueItemsTable, type Connector } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createCalendarClient, refreshCalendarAccessToken, type CalendarTokens } from "@workspace/integration-google-calendar";
import { encryptToken, decryptToken } from "../crypto";
import { runPoll } from "./pollHelpers";

const REFRESH_SAFETY_MARGIN_MS = 2 * 60 * 1000;

async function getValidAccessToken(connector: Connector): Promise<string> {
  if (!connector.oauthTokenRef) throw new Error("Connector has no stored token");
  const tokens = JSON.parse(decryptToken(connector.oauthTokenRef)) as CalendarTokens;

  if (tokens.expiresAt - Date.now() > REFRESH_SAFETY_MARGIN_MS) return tokens.accessToken;

  const refreshed = await refreshCalendarAccessToken(tokens.refreshToken);
  const nextTokens: CalendarTokens = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  await db.update(connectorsTable).set({ oauthTokenRef: encryptToken(JSON.stringify(nextTokens)) }).where(eq(connectorsTable.id, connector.id));
  return nextTokens.accessToken;
}

// One conflict pair = one queue item, deduped on a stable key made from
// both event ids so re-polling the same 24h window never re-flags a
// conflict the founder already saw.
export async function pollCalendarConnector(userId: string, connector: Connector): Promise<number> {
  return runPoll(connector, async () => {
    const accessToken = await getValidAccessToken(connector);
    const calendar = await createCalendarClient(async () => accessToken);

    let created = 0;
    try {
      const conflicts = await calendar.listUpcomingConflicts();
      for (const conflict of conflicts) {
        const dedupeKey = [conflict.eventA.id, conflict.eventB.id].sort().join(":");
        const inserted = await db
          .insert(queueItemsTable)
          .values({
            userId,
            type: "schedule_alert",
            source: "calendar",
            title: "Double-booked on your calendar",
            body: `"${conflict.eventA.summary}" overlaps with "${conflict.eventB.summary}"`,
            externalId: dedupeKey,
          })
          .onConflictDoNothing({ target: [queueItemsTable.userId, queueItemsTable.source, queueItemsTable.externalId] })
          .returning({ id: queueItemsTable.id });
        if (inserted.length > 0) created++;
      }
    } finally {
      await calendar.close();
    }

    return created;
  });
}
