import { Router } from "express";
import { z } from "zod/v4";
import { clerkClient } from "@clerk/express";
import { db, auditEventsTable, userStatusTable, usageDailyTable, chatsTable, messagesTable, attachmentsTable } from "@workspace/db";
import { and, desc, eq, gte, or, sql, count } from "drizzle-orm";
import { requireAuth, requireOperator, requireUserId } from "../middlewares/auth";
import { recordAuditEvent } from "../lib/auditLog";
import { suspendUser, unsuspendUser } from "../lib/userStatus";
import { logger } from "../lib/logger";

/* ---------------------------------------------------------------------------
   THE OPERATOR SURFACE

   THE GAP THIS CLOSES. Vera had no way to act on a single user. The privacy
   policy reserved a suspension right nothing implemented; security events were
   written to stdout with no retention and no query; and "what did this account
   actually do" was answerable only from a database shell. So the real options
   during an abuse incident were: delete the person's Clerk account, or take the
   whole product down. Neither is proportionate and neither leaves a record.

   WHAT THIS IS AND IS NOT. It is a small, mostly READ-ONLY JSON surface for one
   person to answer four questions and take three actions. It is not an admin
   panel, and it deliberately has no UI — a set of URLs a founder can open in a
   browser while signed in is the whole interface, because every screen added
   here is a screen that has to be secured, and the value is in the data being
   reachable at all.

   THREE RULES IT FOLLOWS THROUGHOUT:

     1. NEVER RETURNS USER CONTENT. Not a message body, not a filename, not a
        dossier field. Counts, timestamps, ids, event types. This is what makes
        it safe for one user to look at another user's account without reading
        their business — and it is the reason the answer to "what did they say"
        is still a SQL query, deliberately. Reading a founder's transcript
        should require more friction than clicking a link, even for the operator.
     2. EVERY READ IS ITSELF AUDITED. Looking at an account is an event. An
        operator surface with no record of who looked at what is the thing that
        turns one compromised session into an undetectable data problem.
     3. DESTRUCTIVE ACTIONS REQUIRE THE REASON AND THE ID TOGETHER. No bulk
        endpoints, no "suspend all", nothing that takes a filter instead of an
        id. The blast radius of a mistake here is one account by construction.

   Access is an allowlist of Clerk user ids in OPERATOR_USER_IDS — see
   middlewares/auth.ts for why privilege cannot be granted from inside the app.
--------------------------------------------------------------------------- */

const router = Router();

// Applied to every route below in one place rather than per-route, so a new
// operator endpoint cannot be added without both guards. Same reasoning as the
// frontend router's deny-by-default shape.
router.use("/operator", requireAuth, requireOperator);

/* -------------------------------------------------------------------------
 * Who am I, and is this thing configured
 * ---------------------------------------------------------------------- */

// The endpoint to hit first. Confirms the allowlist actually contains you —
// which is the one piece of setup that is easy to get wrong (a Clerk user id is
// `user_2abc…`, not an email) and produces a 404 that looks like a broken
// deployment rather than a configuration mistake.
router.get("/operator/whoami", (req, res) => {
  const userId = requireUserId(req);
  return res.json({ operator: true, userId });
});

/* -------------------------------------------------------------------------
 * Find a user
 * ---------------------------------------------------------------------- */

// Search goes to Clerk because Clerk is where identity lives — Vera has no
// users table and inventing one would mean two sources of truth for who exists.
// Returns only what is needed to identify the right person and decide whether to
// act: no metadata, no session tokens.
router.get("/operator/users", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const actorId = requireUserId(req);

  try {
    const list = await clerkClient.users.getUserList({
      ...(query ? { query } : {}),
      limit: 25,
      orderBy: "-created_at",
    });

    // One status lookup for the whole page rather than per row.
    const ids = list.data.map((u) => u.id);
    const statuses =
      ids.length > 0
        ? await db
            .select({ userId: userStatusTable.userId, status: userStatusTable.status, reason: userStatusTable.reason })
            .from(userStatusTable)
            .where(or(...ids.map((id) => eq(userStatusTable.userId, id))))
        : [];
    const statusById = new Map(statuses.map((s) => [s.userId, s]));

    void recordAuditEvent({
      eventType: "operator.searched_users",
      actorId,
      severity: "info",
      metadata: { query: query || "(all)", results: list.data.length },
    });

    return res.json({
      users: list.data.map((u) => ({
        userId: u.id,
        email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
        createdAt: u.createdAt,
        lastSignInAt: u.lastSignInAt,
        // Clerk's own ban flag, distinct from Vera's suspension — they are two
        // different controls and showing both prevents "I suspended them, why
        // can they still sign in" (Clerk ban blocks the login; Vera suspension
        // blocks the API).
        clerkBanned: u.banned,
        veraStatus: statusById.get(u.id)?.status ?? "active",
        veraStatusReason: statusById.get(u.id)?.reason ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Operator user search failed");
    return res.status(502).json({ error: "Could not reach the identity provider" });
  }
});

/* -------------------------------------------------------------------------
 * What has this account been doing
 * ---------------------------------------------------------------------- */

// Activity as COUNTS AND TIMESTAMPS, never content — see rule 1. This answers
// "is this account behaving like a person or like a script", which is the
// question an abuse report actually turns on, without opening their books.
router.get("/operator/users/:userId/activity", async (req, res) => {
  const targetUserId = String(req.params.userId);
  const actorId = requireUserId(req);

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [chats, messages, attachments, recentEvents, usage, status] = await Promise.all([
      db.select({ n: count() }).from(chatsTable).where(eq(chatsTable.userId, targetUserId)),
      db
        .select({ n: count() })
        .from(messagesTable)
        .where(and(eq(messagesTable.userId, targetUserId), gte(messagesTable.createdAt, since))),
      db.select({ n: count() }).from(attachmentsTable).where(eq(attachmentsTable.userId, targetUserId)),
      db
        .select()
        .from(auditEventsTable)
        .where(eq(auditEventsTable.userId, targetUserId))
        .orderBy(desc(auditEventsTable.createdAt))
        .limit(50),
      db
        .select()
        .from(usageDailyTable)
        .where(or(eq(usageDailyTable.subject, targetUserId), eq(usageDailyTable.subject, `u:${targetUserId}`)))
        .orderBy(desc(usageDailyTable.day))
        .limit(14),
      db.select().from(userStatusTable).where(eq(userStatusTable.userId, targetUserId)).limit(1),
    ]);

    void recordAuditEvent({
      eventType: "operator.viewed_user",
      userId: targetUserId,
      actorId,
      severity: "info",
    });

    return res.json({
      userId: targetUserId,
      status: status[0]?.status ?? "active",
      statusReason: status[0]?.reason ?? null,
      statusChangedAt: status[0]?.updatedAt ?? null,
      counts: {
        chats: chats[0]?.n ?? 0,
        messagesLast30Days: messages[0]?.n ?? 0,
        attachments: attachments[0]?.n ?? 0,
      },
      // The abuse-relevant number: model calls per day, and whether they hit
      // the cap. A human founder does not spend 250 analyses in a day.
      usageByDay: usage.map((u) => ({ day: u.day, modelCalls: u.spent, cooldownUntil: u.cooldownUntil })),
      recentEvents: recentEvents.map(serializeEvent),
    });
  } catch (err) {
    logger.error({ err, targetUserId }, "Operator activity lookup failed");
    return res.status(500).json({ error: "Could not load activity for that account" });
  }
});

/* -------------------------------------------------------------------------
 * Security events
 * ---------------------------------------------------------------------- */

function serializeEvent(e: typeof auditEventsTable.$inferSelect) {
  return {
    id: e.id,
    at: e.createdAt,
    type: e.eventType,
    severity: e.severity,
    userId: e.userId,
    actorId: e.actorId,
    subject: e.subject,
    route: e.route,
    // Parsed so the operator reads a value rather than a JSON string. Safe by
    // construction: auditLog.ts only ever stores primitives.
    metadata: e.metadataJson ? safeParse(e.metadataJson) : null,
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const EventQuery = z.object({
  // Prefix match, so "abuse." gets every abuse event and "abuse.rate_limited"
  // gets one kind. Cheap to use from a URL bar, which is the actual interface.
  type: z.string().max(64).optional(),
  severity: z.enum(["info", "warn", "critical"]).optional(),
  userId: z.string().max(128).optional(),
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// The endpoint that replaces "read the Replit console and hope". This is where
// you look when something is wrong.
router.get("/operator/events", async (req, res) => {
  const parsed = EventQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query — check type, severity, userId, hours, limit" });
  const { type, severity, userId, hours, limit } = parsed.data;
  const actorId = requireUserId(req);

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const conditions = [gte(auditEventsTable.createdAt, since)];
    if (type) conditions.push(sql`${auditEventsTable.eventType} LIKE ${type + "%"}`);
    if (severity) conditions.push(eq(auditEventsTable.severity, severity));
    if (userId) conditions.push(eq(auditEventsTable.userId, userId));

    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(and(...conditions))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(limit);

    return res.json({ windowHours: hours, count: rows.length, events: rows.map(serializeEvent) });
  } catch (err) {
    logger.error({ err, actorId }, "Operator event query failed");
    return res.status(500).json({ error: "Could not load events" });
  }
});

// The one-screen answer to "is anything wrong right now". Counts by type over a
// window, so a spike is visible without reading individual rows — this is the
// thing to open first, and the thing a scheduled check could poll.
router.get("/operator/summary", async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [byType, suspended, topUsage] = await Promise.all([
      db
        .select({ type: auditEventsTable.eventType, severity: auditEventsTable.severity, n: count() })
        .from(auditEventsTable)
        .where(gte(auditEventsTable.createdAt, since))
        .groupBy(auditEventsTable.eventType, auditEventsTable.severity)
        .orderBy(desc(count())),
      db.select().from(userStatusTable).where(eq(userStatusTable.status, "suspended")),
      db
        .select()
        .from(usageDailyTable)
        .where(eq(usageDailyTable.day, new Date().toISOString().slice(0, 10)))
        .orderBy(desc(usageDailyTable.spent))
        .limit(10),
    ]);

    return res.json({
      windowHours: hours,
      events: byType.map((r) => ({ type: r.type, severity: r.severity, count: r.n })),
      suspendedAccounts: suspended.map((s) => ({ userId: s.userId, reason: s.reason, since: s.updatedAt })),
      // Who is spending the shared Groq quota today, worst first.
      topUsageToday: topUsage.map((u) => ({ subject: u.subject, modelCalls: u.spent, cooldownUntil: u.cooldownUntil })),
    });
  } catch (err) {
    logger.error({ err }, "Operator summary failed");
    return res.status(500).json({ error: "Could not build the summary" });
  }
});

/* -------------------------------------------------------------------------
 * Act
 * ---------------------------------------------------------------------- */

const ActionBody = z.object({
  // Required, and long enough to be a sentence. A suspension with "test" in the
  // reason field is one that will be argued about in three months.
  reason: z.string().trim().min(10, "Give a real reason — this is the record you will read later").max(500),
});

router.post("/operator/users/:userId/suspend", async (req, res) => {
  const targetUserId = String(req.params.userId);
  const actorId = requireUserId(req);

  const body = ActionBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.issues[0]?.message ?? "A reason of at least 10 characters is required" });
  }

  // Guards against the worst available mistake: locking yourself out of the
  // surface you use to unlock people.
  if (targetUserId === actorId) {
    return res.status(400).json({ error: "You cannot suspend your own operator account." });
  }

  try {
    await suspendUser({ userId: targetUserId, actorId, reason: body.data.reason });
    return res.json({ userId: targetUserId, status: "suspended", reason: body.data.reason });
  } catch (err) {
    logger.error({ err, targetUserId }, "Suspend failed");
    return res.status(500).json({ error: "Could not suspend that account" });
  }
});

router.post("/operator/users/:userId/unsuspend", async (req, res) => {
  const targetUserId = String(req.params.userId);
  const actorId = requireUserId(req);

  const body = ActionBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.issues[0]?.message ?? "A reason of at least 10 characters is required" });
  }

  try {
    await unsuspendUser({ userId: targetUserId, actorId, reason: body.data.reason });
    return res.json({ userId: targetUserId, status: "active", reason: body.data.reason });
  } catch (err) {
    logger.error({ err, targetUserId }, "Unsuspend failed");
    return res.status(500).json({ error: "Could not restore that account" });
  }
});

// Ends every active session for one user, at Clerk. Distinct from suspension,
// and both are useful: suspension stops them using the API while they stay
// signed in; this stops the session itself, which is what a compromised-account
// report calls for. Suspending does NOT revoke sessions, so the two are exposed
// separately rather than one silently doing the other.
router.post("/operator/users/:userId/revoke-sessions", async (req, res) => {
  const targetUserId = String(req.params.userId);
  const actorId = requireUserId(req);

  const body = ActionBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.issues[0]?.message ?? "A reason of at least 10 characters is required" });
  }

  try {
    const sessions = await clerkClient.sessions.getSessionList({ userId: targetUserId, status: "active" });
    let revoked = 0;
    for (const session of sessions.data) {
      await clerkClient.sessions.revokeSession(session.id);
      revoked++;
    }

    await recordAuditEvent({
      eventType: "auth.sessions_revoked",
      userId: targetUserId,
      actorId,
      severity: "critical",
      metadata: { revoked, reason: body.data.reason },
    });

    return res.json({ userId: targetUserId, sessionsRevoked: revoked });
  } catch (err) {
    logger.error({ err, targetUserId }, "Session revocation failed");
    return res.status(502).json({ error: "Could not revoke sessions at the identity provider" });
  }
});

export default router;
