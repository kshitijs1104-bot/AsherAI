import type { NextFunction, Request, Response } from "express";
import { clerkMiddleware as clerkExpressMiddleware, getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { isSuspended } from "../lib/userStatus";
import { recordAuditEvent } from "../lib/auditLog";

// This file replaces the old `(req.headers["x-session-id"] as string) || req.ip
// || "default"` pattern that every /ai/* route used for identity. That pattern
// was never real identity — req.ip changes across NAT/mobile-network/VPN
// hops, and two people behind the same IP (same office wifi, same campus)
// silently shared a "session": each other's decision history, roadmap cards,
// and (once built) Goal state. x-session-id was sent by exactly one frontend
// file (ArticleDrawer.tsx) and never by Venus.tsx itself, so in practice the
// header was almost always absent and every Venus user fell through to IP.
//
// clerkMiddleware() reads the session token from the Authorization header
// (or __session cookie) on every request and, if present and valid, attaches
// auth info to the request via getAuth(req). It does NOT reject unauthenticated
// requests by itself — that's what requireAuth below is for. Mounting
// clerkMiddleware globally (see app.ts) is what makes getAuth(req) available
// everywhere, including public routes that want to optionally recognize a
// signed-in user without requiring it.

// ---- Why Clerk's middleware is wrapped rather than re-exported ----
//
// THE FAILURE THIS FIXES, found by running the server against an unreachable
// Clerk. clerkMiddleware() calls out to Clerk to fetch the JWKS it verifies
// tokens with. When that call fails — a Clerk outage, a network partition, a
// revoked key — it THROWS, and an unhandled throw in a globally-mounted
// middleware means every request lands in the app-level error handler as a bare
// 500. Observed exactly that: the first token-bearing request after boot
// returned 500 rather than a clean 401 or an honest "sign-in is unavailable".
//
// Three things were wrong with that. A 500 tells the client the server is
// broken when the truth is that one dependency is; it gives the founder no
// actionable message; and it makes an auth-provider outage indistinguishable
// from a bug in Vera in the error rate an operator is watching.
//
// So: a provider failure becomes 503 with a Retry-After and a readable
// sentence, and it is logged at error as its own event. It still fails CLOSED —
// nothing downstream sees a userId — which is the property that matters.
export function clerkMiddleware() {
  const inner = clerkExpressMiddleware();
  return function clerkMiddlewareWithOutageHandling(req: Request, res: Response, next: NextFunction) {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (!err) return next();

      logger.error({ err, path: req.path }, "Authentication provider failed — returning 503");
      if (res.headersSent) return;
      res.setHeader("Retry-After", "30");
      res.status(503).json({
        error: "Sign-in is temporarily unavailable. This is on our side, not yours — please try again in a moment.",
      });
    };

    try {
      // Clerk's middleware can fail synchronously or by calling next(err);
      // both routes end up here.
      Promise.resolve(inner(req, res, done as NextFunction)).catch(done);
    } catch (err) {
      done(err);
    }
  };
}

/**
 * Route guard for anything that needs a real, verified user — this is what
 * /ai/* and the /goals endpoints use instead of the old inline sessionId
 * fallback line. Responds 401 if there's no valid Clerk session rather than
 * silently degrading to an IP-derived identity.
 *
 * IT ALSO ENFORCES SUSPENSION, which is the point of it being one guard rather
 * than two. Every authenticated route in this server already goes through here,
 * so putting the check inside it means suspension covers all of them the day it
 * ships and covers any route added later without anyone remembering to. A
 * separate `requireNotSuspended` would have been opt-in, which is the same
 * mistake the routing layer used to make with authentication.
 *
 * A suspended user gets 403 with a message that names the situation and where
 * to write, not a 401 — 401 would send the frontend into a sign-in redirect
 * loop, since their credentials are perfectly valid and signing in again
 * changes nothing.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    logger.warn({ path: req.path }, "Rejected request with no verified Clerk session");
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  void (async () => {
    try {
      if (await isSuspended(auth.userId)) {
        logger.warn({ userId: auth.userId, path: req.path }, "Blocked a suspended account");
        // Recorded so an operator can see whether a suspended account is still
        // hammering the API — which is the difference between "they got the
        // message" and "they are working around it".
        void recordAuditEvent({
          eventType: "auth.blocked_suspended",
          userId: auth.userId,
          actorId: auth.userId,
          subject: `u:${auth.userId}`,
          route: req.path,
          severity: "warn",
        });
        res.status(403).json({
          error: "This account has been suspended. If you think that's a mistake, reply to your signup email and we'll look at it.",
        });
        return;
      }
      next();
    } catch (err) {
      // isSuspended already fails open internally; this catch is for anything
      // unexpected around it. Same direction, same reason.
      logger.error({ err, userId: auth.userId }, "Suspension gate threw — allowing the request through");
      next();
    }
  })();
}

// Convenience accessor so route handlers can do `const userId = requireUserId(req)`
// instead of re-deriving it. Only safe to call after requireAuth has run
// (i.e. inside a route mounted behind it) — throws otherwise so a missing
// requireAuth() on some future route fails loudly in dev instead of quietly
// resolving to undefined and re-opening the IP-fallback-style bug this file
// exists to close.
export function requireUserId(req: Request): string {
  const auth = getAuth(req);
  if (!auth?.userId) {
    throw new Error(
      "requireUserId() called on a request with no verified session — this route is missing the requireAuth middleware.",
    );
  }
  return auth.userId;
}

/* ---------------------------------------------------------------------------
   Operator access.

   WHY AN ENV ALLOWLIST AND NOT A ROLE COLUMN. A role column is the right answer
   for a team; for one founder it adds a table, a way to grant the role, and a
   new question ("who can grant it?") in exchange for nothing. An allowlist of
   Clerk user ids in the environment has the property that matters most here:
   privilege cannot be granted by anything inside the application. There is no
   endpoint that promotes a user, so there is no endpoint to find a flaw in, and
   no database write can make somebody an operator. Changing who is an operator
   is a Secrets edit and a restart.

   UNSET MEANS NOBODY. Deliberately not "unset means everybody" and not "unset
   means the first user" — an operator surface that is open because a variable
   was forgotten is worse than one that is unreachable.
--------------------------------------------------------------------------- */

const OPERATOR_USER_IDS = new Set(
  (process.env.OPERATOR_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export function isOperator(userId: string | null | undefined): boolean {
  return !!userId && OPERATOR_USER_IDS.has(userId);
}

export function operatorCount(): number {
  return OPERATOR_USER_IDS.size;
}

/**
 * Guards the operator routes. Mount AFTER requireAuth so the caller is already
 * a verified user — this only answers "is that user you".
 *
 * A non-operator gets 404, not 403. 403 confirms the endpoint exists and that
 * there is something behind it worth finding; 404 says nothing. The attempt is
 * recorded either way, because an authenticated user probing /operator/* is one
 * of the few signals here that is never innocent.
 */
export function requireOperator(req: Request, res: Response, next: NextFunction) {
  const userId = getAuth(req)?.userId ?? null;

  if (!isOperator(userId)) {
    logger.warn({ userId, path: req.path }, "Non-operator attempted an operator route");
    void recordAuditEvent({
      eventType: "operator.denied",
      userId,
      actorId: userId,
      route: req.path,
      severity: "critical",
    });
    res.status(404).json({ error: "Not found" });
    return;
  }

  next();
}
