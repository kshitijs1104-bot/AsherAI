import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import { getAuth } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "./middlewares/auth";
import { sameOriginOnly } from "./middlewares/csrf";
import { dailyUsageLimit } from "./middlewares/usageLimit";

if (!process.env["CLERK_SECRET_KEY"]) {
  throw new Error(
    "CLERK_SECRET_KEY environment variable is required but was not provided. " +
      "Set it in your Replit Secrets — see artifacts/api-server/.env.example.",
  );
}

const isProduction = process.env.NODE_ENV === "production";

// ---- Which origins may call this API ----
//
// Was `origin: "*"` under a `// TODO: lock down before production` comment.
// A wildcard means any page on the internet can call every endpoint here and
// read the response — including, before the fix below, one that accepted an
// attacker-supplied `x-groq-api-key` header.
//
// ALLOWED_ORIGIN is a comma-separated list (the deployed frontend, plus any
// preview URL that needs to reach this API). In production an unset value is
// fatal rather than defaulting to something permissive: a misconfigured deploy
// should fail loudly at boot, not come up silently accepting every origin. In
// development it falls back to the usual local Vite ports.
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5000", "http://127.0.0.1:5000"];

const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (isProduction && allowedOrigins.length === 0) {
  throw new Error(
    "ALLOWED_ORIGIN environment variable is required in production. " +
      "Set it to the frontend origin(s) allowed to call this API, comma-separated " +
      '(e.g. "https://app.example.com"). Refusing to start with an open CORS policy.',
  );
}

const corsOrigins = allowedOrigins.length > 0 ? allowedOrigins : DEV_ORIGINS;

const app: Express = express();

// Replit (like every other PaaS here) terminates TLS at its edge and
// forwards plain HTTP to this process, so without this `req.protocol` is
// "http" and `req.ip` is the proxy's address. That broke OAuth outright:
// routes/connectors.ts builds each provider's redirect_uri from
// req.protocol, so it sent Google `http://<host>/api/connectors/gmail/
// callback` while the console can only whitelist the https:// form —
// hence "Error 400: redirect_uri_mismatch" on every connector. Trusting
// the first proxy hop makes req.protocol/req.ip reflect the original
// client request.
//
// This also makes req.ip trustworthy enough to rate-limit on (see below):
// with `trust proxy` unset, every request appears to come from the proxy and
// a per-IP limiter would throttle all users as though they were one client.
app.set("trust proxy", 1);

// ---- Baseline security headers ----
//
// Most of what helmet sets matters less for a JSON API than for an HTML app,
// but two headers here are load-bearing:
//
//   X-Content-Type-Options: nosniff — GET /attachments/:id serves founder-
//   uploaded files back with their stored Content-Type and an inline
//   disposition. Without nosniff, a browser may ignore that type and sniff
//   the bytes instead, so a .txt or .csv whose contents happen to look like
//   HTML can execute as a document on this origin. This turns "we store the
//   file" into stored XSS. The upload allowlist makes that hard to hit, but
//   nosniff is what makes it structurally impossible rather than unlikely.
//
//   Cross-Origin-Resource-Policy: same-site — stops those same attachment
//   bytes from being embedded by arbitrary third-party pages.
//
// contentSecurityPolicy is disabled: this process serves JSON and file
// downloads, never HTML documents, so a document CSP has nothing to apply to
// here. The frontend is served separately and sets its own.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS must be registered before any routes so preflight (OPTIONS) requests are
// handled for every endpoint, including the AI POST routes.
//
// allowedHeaders lost two entries. `x-groq-api-key` was read by several routes
// to override which credential outbound LLM calls used — an unauthenticated
// way to steer the server's inference, now removed from every handler.
// `x-session-id` was the header half of the `x-session-id || req.ip` identity
// pattern that middlewares/auth.ts replaced with verified Clerk sessions;
// nothing reads it any more, and advertising it invites its return.
app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  }),
);

// Explicit body ceiling. Express's default is 100kb, which is already
// reasonable, but stating it means a future change to the default (or to a
// route that wants larger bodies) is a deliberate decision rather than an
// inherited one. Uploads do not pass through here — multer streams them to
// disk with its own 10MB limit (see routes/attachments.ts).
app.use(express.json({ limit: "256kb" }));

// `express.urlencoded` was removed rather than tightened. No route reads a
// form-encoded body — every handler either zod-parses JSON (all of them, see
// the `safeParse(req.body)` calls) or takes multipart via multer. What
// mounting it DID do was accept `application/x-www-form-urlencoded`, which is
// one of the three "simple" content types a cross-origin <form> can post
// without a CORS preflight. Since auth here is a cookie, that was the cheapest
// available CSRF surface, kept open by a parser nothing used. Removing it
// costs nothing and closes one of the two simple-request paths; the other
// (multipart, needed by /attachments) is covered by sameOriginOnly below.

// ---- cookie-parser: this was missing, and it silently broke OAuth ----
//
// routes/connectors.ts implements the standard OAuth CSRF guard: mint a random
// `state`, store it in an httpOnly cookie, and compare the two at /callback.
// The comparison reads `req.cookies?.[OAUTH_STATE_COOKIE]` — but nothing ever
// populated req.cookies, because cookie-parser was a declared dependency that
// was never mounted. `req.cookies` was always undefined, so the guard's
// `!cookieState` branch matched on every single callback and every connector
// attempt died at "OAuth state mismatch".
//
// It failed closed, which is the right direction to fail — but it meant the
// CSRF check had never actually run in its intended form, and no connector
// could be linked at all. Mounting the parser makes the guard real.
app.use(cookieParser());

// Reads and verifies the Clerk session token on every request (Authorization
// header or __session cookie) and makes it available via getAuth(req) in any
// downstream handler. Does not reject unauthenticated requests on its own —
// routes that must be signed-in use requireAuth from ./middlewares/auth.
app.use(clerkMiddleware());

// ---- CSRF ----
//
// Must come after cors() (so real preflights are already answered) and after
// clerkMiddleware (so a blocked request is still logged with whatever
// identity it had). Applies only to POST/PUT/PATCH/DELETE — see
// middlewares/csrf.ts for why an Origin check rather than a token, and why
// CORS alone was not protecting these routes. Given the same origin list as
// cors() so the two can never drift.
app.use(sameOriginOnly(corsOrigins));

// ---- Rate limiting ----
//
// There was none anywhere in this server. Every limiter below keys on the
// authenticated Clerk user when there is one, falling back to IP otherwise,
// which is the important detail: keying on IP alone would let one account
// rotate addresses to multiply its budget, while throttling a whole office or
// campus behind a single NAT as though they were one user. The IP fallback
// runs through express-rate-limit's ipKeyGenerator so IPv6 clients are
// bucketed by subnet rather than by individual address (a single IPv6 host is
// typically handed enough addresses to trivially evade a per-address limit).
function userOrIpKey(req: express.Request): string {
  const userId = getAuth(req)?.userId;
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

// Every limiter below logs when it trips. A single 429 is a founder typing
// fast; a stream of them against one key is either a runaway client or
// someone walking the endpoints, and neither is visible if the limiter
// silently returns a status. This is the security-event log for abuse — it
// records WHICH limiter and WHICH key, never the request body.
function loggingHandler(limiterName: string, body: { error: string }) {
  return function handler(req: express.Request, res: express.Response) {
    logger.warn({ limiter: limiterName, key: userOrIpKey(req), path: req.path, method: req.method }, "Rate limit exceeded");
    res.status(429).json(body);
  };
}

// Applies to everything. Sized to be invisible to real use of the product and
// still cap automated hammering.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: loggingHandler("global", { error: "Too many requests — slow down and try again shortly." }),
});

// Tighter budget for the routes that cost real money per call. /ai/* and
// /actions/* each run a Groq completion; /attachments accepts a 10MB write to
// local disk. These are the endpoints where unbounded calls turn into a bill
// or a full disk rather than just load.
const expensiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: loggingHandler("expensive", { error: "You're sending requests faster than Vera can think — give it a moment." }),
});

// ---- Daily ceiling on model calls, which the per-minute limiter is not ----
//
// THE GAP THIS CLOSES. `expensiveLimiter` caps the RATE (30/min) but not the
// TOTAL. Sustained at the limit that is 43,200 model calls per user per day —
// so "rate limited" and "unbounded" were the same thing over any window
// longer than a minute. What makes that concrete rather than theoretical here
// is that Groq bills against an ORG-WIDE daily token quota (routes/ai.ts
// already handles the 429 for hitting it, and the comments there record a day
// when the org's 200,000/day was exhausted). One account looping overnight
// therefore doesn't just run up its own bill — it spends everyone else's
// quota, and every other founder's next question fails. A per-user daily cap
// is what turns that from an outage into one noisy account hitting its own
// wall.
//
// The budget itself (250 calls, then a five-hour cooldown) and why it isn't
// another express-rate-limit block live in middlewares/usageLimit.ts. Given
// the SAME key function as the limiters above on purpose — two limiters that
// disagree about who a caller is are two limiters with different ceilings.
const dailyModelCallLimiter = dailyUsageLimit(userOrIpKey);

app.use("/api", globalLimiter);
app.use(["/api/ai", "/api/actions", "/api/attachments"], expensiveLimiter);
app.use(["/api/ai", "/api/actions"], dailyModelCallLimiter);

app.use("/api", router);

// Without this, an error thrown by middleware BEFORE it reaches a route's
// own try/catch (multer's fileFilter/size-limit rejection being the
// concrete case that surfaced this — see routes/attachments.ts) falls
// through to Express's default error handler, which renders an HTML page.
// The frontend's apiFetch/fetch callers all assume a JSON error body and
// silently fall back to a generic message when that assumption breaks —
// this is what made a real, specific failure (wrong file type, DB table
// missing, whatever) show up to founders as an unhelpful "Upload failed"/
// "Request failed" with no way to tell what actually went wrong.
//
// WHAT CHANGED: it used to return `err.message` for every status, including
// 500s. A 500 means something the code did not anticipate — a failed query, a
// bad env var, a library throwing — and those messages routinely carry table
// names, file paths, connection strings and stack detail. Handing that to the
// caller is free reconnaissance. 4xx messages are still returned verbatim,
// because those are deliberate, founder-readable text written at the throw
// site ("send a PDF, Word, Excel… file"); 5xx now gets a fixed string, with
// the real error logged server-side where it belongs.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  req.log?.error(err, "Unhandled error");
  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 500;
  const message = status < 500 && typeof err?.message === "string" ? err.message : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
