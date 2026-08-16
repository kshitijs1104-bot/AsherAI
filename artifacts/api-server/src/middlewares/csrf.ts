import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

// ---- Why this exists, given CORS is already locked down ----
//
// THE GAP THIS CLOSES. Authentication here is a COOKIE. venusApi.ts's
// apiFetch sends no bearer token — it relies on the browser attaching Clerk's
// `__session` cookie to same-origin requests, and app.ts's CORS is configured
// `credentials: false` precisely because the frontend and API are served from
// one origin in production.
//
// CORS does not stop CSRF, and this is the part that is routinely misread. A
// cross-site POST is SENT before CORS is consulted; what CORS withholds is the
// attacker's ability to READ the response. For a state-changing endpoint the
// attacker does not need to read anything — `DELETE /api/account` succeeding
// is the entire payload. Any page on the internet could, in principle, submit
// a form or issue a fetch at this API, and the browser would attach the
// victim's session cookie for it.
//
// Two things stood between that and a working attack, and neither is a
// control this codebase owns:
//
//   - Clerk sets `__session` SameSite=Lax, so browsers withhold it on
//     cross-site POSTs. That is a real defence, but it is a THIRD PARTY'S
//     DEFAULT. It is set in Clerk's dashboard, not in this repo, and nothing
//     here fails if someone relaxes it to SameSite=None to fix an embedding
//     or Safari issue. The protection would disappear silently.
//   - Requests that trigger a CORS preflight can't be forged this way. But
//     "simple" requests don't preflight, and two of the three simple content
//     types were reachable here: `application/x-www-form-urlencoded` (a plain
//     HTML <form> — the body parser for it has now been removed from app.ts,
//     since nothing posts form-encoded) and `multipart/form-data`, which
//     POST /api/attachments accepts by design.
//
// So the server had no CSRF control of its own. This middleware is that
// control, and it is deliberately the cheap kind rather than a token: a
// synchroniser token would need issuing, storing and rotating for a benefit
// this check already delivers for a JSON API where every legitimate caller
// is either the first-party frontend or a bearer-token client.
//
// THE RULE: on any state-changing method, the request must prove it did not
// originate from a foreign page. It proves that one of two ways.
//
//   1. It carries `Authorization: Bearer …`. A browser NEVER attaches that
//      header on its own — the attacker's page would have to set it, and
//      setting it forces a preflight that CORS then refuses. So a request
//      with a bearer token cannot be a drive-by, and this is what keeps
//      non-browser clients (scripts, a future mobile app, the generated
//      OpenAPI client if it switches to tokens) working unchanged.
//   2. Its `Origin` (or, failing that, `Referer`) matches an allowed origin.
//      Browsers have sent `Origin` on every POST/PUT/PATCH/DELETE for years,
//      including same-origin ones, which is what makes requiring it viable
//      rather than a source of mystery 403s.
//
// A state-changing request with neither is refused. That is the failure mode
// we want: fail closed, and fail with a message that says which of the two is
// missing, so a real integration debugging this is not left guessing.

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Blocks cross-site state-changing requests. Mount AFTER the CORS middleware
 * (so genuine preflights are already answered) and BEFORE the routes.
 *
 * @param allowedOrigins the same list app.ts hands to `cors()` — one source of
 *   truth, so an origin added for CORS is never accidentally left out here and
 *   silently broken for writes but not reads.
 */
export function sameOriginOnly(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.trim().replace(/\/$/, "")));

  return function sameOriginOnlyMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();

    // Bearer-authenticated calls can't be forged by a foreign page — see (1).
    const authHeader = req.get("authorization");
    if (authHeader && /^bearer\s+\S/i.test(authHeader)) return next();

    // `Origin` is the header browsers control and scripts cannot spoof.
    // `Referer` is the fallback for the rare client that omits Origin; it is
    // weaker (it can be stripped by privacy settings) which is exactly why it
    // is a fallback and not the primary check.
    const origin = originOf(req.get("origin")) ?? originOf(req.get("referer"));

    if (origin && allowed.has(origin)) return next();

    // Logged at warn with the offending origin: an unexplained cross-site
    // write attempt against an authenticated API is a security event, not
    // noise, and it is the signal that someone is probing this server.
    logger.warn(
      { path: req.path, method: req.method, origin: origin ?? req.get("origin") ?? req.get("referer") ?? null },
      "Blocked state-changing request with missing or foreign Origin",
    );

    res.status(403).json({
      error: origin
        ? "This request came from an origin that isn't allowed to make changes here."
        : "This request is missing an Origin header. Browser clients must call this API from an allowed origin; other clients must send an Authorization: Bearer token.",
    });
  };
}
