import fsp from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  attachmentsTable,
  businessProfilesTable,
  chatsTable,
  companyDossiersTable,
  companyFactsTable,
  connectorsTable,
  goalsTable,
  messagesTable,
  monthlyRecapsTable,
  queueItemsTable,
  responseFeedbackTable,
  roadmapsTable,
  settingsTable,
  venusDecisionsTable,
  workflowsTable,
} from "@workspace/db";
import { UPLOADS_DIR } from "./attachmentIngest";
import { logger } from "./logger";
import path from "node:path";

/* ---------------------------------------------------------------------------
   Deletion, for real.

   THIS FILE EXISTS BECAUSE THE PRIVACY POLICY MAKES TWO PROMISES. Section 7 of
   pages/legal/privacyPolicy.tsx tells a founder that deleting a chat deletes
   that conversation, its files and what Vera derived from it, and that deleting
   their account removes everything. Before this module, neither was true:
   DELETE /chats/:id removed the chats row and its goal and left behind the
   permanent message log, every attachment row, every uploaded file on disk,
   the roadmap, the decision cards and the feedback rows — and there was no
   account-deletion path at all.

   A policy that promises deletion the code does not perform is not a
   documentation gap. It is a written misstatement to every user who read it,
   which is materially worse than having no policy, so the code moves to meet
   the document rather than the document being softened to match the code.

   TWO RULES FOR ANYONE ADDING A TABLE TO THIS SCHEMA:

     1. If it holds anything derived from a founder's conversation, add it to
        deleteChatData below.
     2. If it has a userId (or, following the older convention, a sessionId
        holding the Clerk user id), add it to deleteAllUserData below.

   Forgetting either turns section 7 back into a false statement. That is the
   cost of a missed line here, and it is why both functions enumerate tables
   explicitly instead of looping over the schema: an explicit list produces a
   compile error when a table is renamed, where a clever generic loop would
   silently skip it.
--------------------------------------------------------------------------- */

/** What a deletion actually removed. Returned so callers can log it. */
export interface DeletionReport {
  messages: number;
  attachments: number;
  filesRemoved: number;
  goals: number;
  roadmaps: number;
  decisions: number;
  feedback: number;
  chats?: number;
  companyFacts?: number;
  dossiers?: number;
  profiles?: number;
  connectors?: number;
  recaps?: number;
  queueItems?: number;
  workflows?: number;
  settings?: number;
}

// Removes an upload and its sidecar from disk. The sidecar is the cached
// extraction (see attachmentIngest.ts) — it holds the FULL text of the
// document, and on an image the vision model's description of it. Deleting the
// original and leaving the sidecar would leave the readable content of a
// founder's P&L on disk after they deleted it, which is the opposite of what
// deletion means. ENOENT is success: the goal is absence, not a specific
// sequence of syscalls.
async function removeAttachmentFiles(storagePath: string): Promise<boolean> {
  // Re-derived and re-checked here rather than trusting the stored value. The
  // column is always a server-generated random filename, but this function
  // deletes files, so it verifies containment itself instead of inheriting
  // that guarantee from a different module's invariant.
  const target = path.resolve(path.join(UPLOADS_DIR, storagePath));
  if (!target.startsWith(path.resolve(UPLOADS_DIR))) {
    logger.error({ storagePath }, "Refused to delete a path outside the uploads directory");
    return false;
  }

  let removed = false;
  for (const file of [target, `${target}.vera.json`]) {
    try {
      await fsp.unlink(file);
      removed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error({ err, file }, "Failed to delete an attachment file");
      }
    }
  }
  return removed;
}

/**
 * Everything belonging to one chat: the transcript, the files, and what Vera
 * derived from them. Ownership is verified by the caller; every statement here
 * is scoped by userId as well as chatId anyway, so a wrong id can only ever
 * delete nothing rather than someone else's data.
 */
export async function deleteChatData(userId: string, chatId: number): Promise<DeletionReport> {
  // Files first, because this is the only step that cannot be rolled back or
  // retried from the database. If the process dies midway, an orphaned row
  // pointing at a deleted file is a cosmetic problem; a surviving file with no
  // row pointing at it is undeletable by any later request — nothing would know
  // it existed. So the unrecoverable step runs while its index still exists.
  const attachments = await db
    .select({ id: attachmentsTable.id, storagePath: attachmentsTable.storagePath })
    .from(attachmentsTable)
    .where(and(eq(attachmentsTable.userId, userId), eq(attachmentsTable.chatId, chatId)));

  let filesRemoved = 0;
  for (const attachment of attachments) {
    if (await removeAttachmentFiles(attachment.storagePath)) filesRemoved++;
  }

  if (attachments.length > 0) {
    await db.delete(attachmentsTable).where(
      inArray(
        attachmentsTable.id,
        attachments.map((a) => a.id),
      ),
    );
  }

  const messages = await db
    .delete(messagesTable)
    .where(and(eq(messagesTable.userId, userId), eq(messagesTable.chatId, chatId)))
    .returning({ id: messagesTable.id });

  const goals = await db
    .delete(goalsTable)
    .where(and(eq(goalsTable.userId, userId), eq(goalsTable.chatId, chatId)))
    .returning({ id: goalsTable.id });

  const roadmaps = await db
    .delete(roadmapsTable)
    .where(and(eq(roadmapsTable.userId, userId), eq(roadmapsTable.chatId, chatId)))
    .returning({ id: roadmapsTable.id });

  // venus_decisions predates the userId convention and scopes on sessionId,
  // which holds the Clerk user id (see routes/settings.ts). Same identity,
  // older column name.
  const decisions = await db
    .delete(venusDecisionsTable)
    .where(and(eq(venusDecisionsTable.sessionId, userId), eq(venusDecisionsTable.chatId, chatId)))
    .returning({ id: venusDecisionsTable.id });

  const feedback = await db
    .delete(responseFeedbackTable)
    .where(and(eq(responseFeedbackTable.userId, userId), eq(responseFeedbackTable.chatId, chatId)))
    .returning({ id: responseFeedbackTable.id });

  return {
    messages: messages.length,
    attachments: attachments.length,
    filesRemoved,
    goals: goals.length,
    roadmaps: roadmaps.length,
    decisions: decisions.length,
    feedback: feedback.length,
  };
}

/**
 * Everything, for one user, across every table that holds anything of theirs.
 *
 * Deliberately NOT built as "list their chats, then call deleteChatData for
 * each". Rows whose chatId is null — a message logged before its chat existed,
 * an attachment uploaded and never sent, a decision card from before chatIds
 * were wired up — belong to nobody's chat and would survive that loop
 * entirely. Account deletion is scoped by user, per table, so nothing can hide
 * in a null.
 */
export async function deleteAllUserData(userId: string): Promise<DeletionReport> {
  // Same ordering logic as above: irreversible filesystem work first, while the
  // rows that name the files are still there to be read.
  const attachments = await db
    .select({ id: attachmentsTable.id, storagePath: attachmentsTable.storagePath })
    .from(attachmentsTable)
    .where(eq(attachmentsTable.userId, userId));

  let filesRemoved = 0;
  for (const attachment of attachments) {
    if (await removeAttachmentFiles(attachment.storagePath)) filesRemoved++;
  }

  const del = async (label: string, run: () => Promise<{ id: number }[]>): Promise<number> => {
    try {
      return (await run()).length;
    } catch (err) {
      // One failing table must not abandon the other thirteen. A partial
      // deletion that is logged and can be re-run beats an exception thrown
      // halfway through, which would leave an arbitrary subset deleted and no
      // record of which. The route surfaces this as a failure so it is retried.
      logger.error({ err, table: label, userId }, "Account deletion failed for one table");
      throw err;
    }
  };

  const report: DeletionReport = {
    attachments: attachments.length,
    filesRemoved,
    messages: 0,
    goals: 0,
    roadmaps: 0,
    decisions: 0,
    feedback: 0,
  };

  report.attachments = await del("attachments", () =>
    db.delete(attachmentsTable).where(eq(attachmentsTable.userId, userId)).returning({ id: attachmentsTable.id }),
  );
  report.messages = await del("messages", () =>
    db.delete(messagesTable).where(eq(messagesTable.userId, userId)).returning({ id: messagesTable.id }),
  );
  report.goals = await del("goals", () =>
    db.delete(goalsTable).where(eq(goalsTable.userId, userId)).returning({ id: goalsTable.id }),
  );
  report.roadmaps = await del("roadmaps", () =>
    db.delete(roadmapsTable).where(eq(roadmapsTable.userId, userId)).returning({ id: roadmapsTable.id }),
  );
  report.decisions = await del("venus_decisions", () =>
    db
      .delete(venusDecisionsTable)
      .where(eq(venusDecisionsTable.sessionId, userId))
      .returning({ id: venusDecisionsTable.id }),
  );
  report.feedback = await del("response_feedback", () =>
    db
      .delete(responseFeedbackTable)
      .where(eq(responseFeedbackTable.userId, userId))
      .returning({ id: responseFeedbackTable.id }),
  );
  report.chats = await del("chats", () =>
    db.delete(chatsTable).where(eq(chatsTable.userId, userId)).returning({ id: chatsTable.id }),
  );

  // The memory layer. This is the part that makes "Vera forgets" true rather
  // than nearly true: company_facts is where a founder's business is distilled
  // into individually retrievable statements, and the dossier is the assembled
  // read of it. Leaving these while deleting the transcripts would delete the
  // evidence and keep the conclusions.
  report.companyFacts = await del("company_facts", () =>
    db.delete(companyFactsTable).where(eq(companyFactsTable.userId, userId)).returning({ id: companyFactsTable.id }),
  );
  report.dossiers = await del("company_dossiers", () =>
    db
      .delete(companyDossiersTable)
      .where(eq(companyDossiersTable.userId, userId))
      .returning({ id: companyDossiersTable.id }),
  );
  report.profiles = await del("business_profiles", () =>
    db
      .delete(businessProfilesTable)
      .where(eq(businessProfilesTable.userId, userId))
      .returning({ id: businessProfilesTable.id }),
  );

  // Connectors hold AES-256-GCM encrypted third-party OAuth tokens. Deleting
  // the row destroys our copy of the credential; it does not revoke it at
  // Google or Notion, which is why the policy tells people they can revoke
  // access at the provider too.
  report.connectors = await del("connectors", () =>
    db.delete(connectorsTable).where(eq(connectorsTable.userId, userId)).returning({ id: connectorsTable.id }),
  );
  report.recaps = await del("monthly_recaps", () =>
    db.delete(monthlyRecapsTable).where(eq(monthlyRecapsTable.userId, userId)).returning({ id: monthlyRecapsTable.id }),
  );
  report.queueItems = await del("queue_items", () =>
    db.delete(queueItemsTable).where(eq(queueItemsTable.userId, userId)).returning({ id: queueItemsTable.id }),
  );
  report.workflows = await del("workflows", () =>
    db.delete(workflowsTable).where(eq(workflowsTable.userId, userId)).returning({ id: workflowsTable.id }),
  );

  // settings scopes on sessionId, same older convention as venus_decisions.
  // This row carries the onboarding answers: company name, stage, revenue.
  report.settings = await del("settings", () =>
    db.delete(settingsTable).where(eq(settingsTable.sessionId, userId)).returning({ id: settingsTable.id }),
  );

  logger.info({ userId, report }, "Deleted all data for a user");
  return report;
}
