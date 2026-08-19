import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import { getAuth } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware, operatorCount } from "./middlewares/auth";
import { sameOriginOnly } from "./middlewares/csrf";
import { dailyUsageLimit } from "./middlewares/usageLimit";
import { recordAuditEvent } from "./lib/auditLog";
import { stripeWebhookHandler } from "./routes/billing";

// ---- Every credential this process cannot run without, checked at boot ----
//
// THE FAILURE THIS PREVENTS, found by running the built server rather than
// reading it. Only CLERK_SECRET_KEY was checked here. But @clerk/express's
// clerkMiddleware ALSO needs CLERK_PUBLISHABLE_KEY on the server — it derives
// the Frontend API host from it before it can verify a session token. With the
// secret key set and the publishable key missing, the process starts, logs
// "Server listening", passes any port check a platform makes — and then throws
// inside the middleware on EVERY request. Confirmed by A/B: without it, 100%
// of requests return 500 including GET /api/healthz; with it, the same
// requests return the correct 200/401/403. So the one endpoint an uptime
// monitor watches goes down with everything else, and the failure is not a
// crash-loop anyone would notice — it is a server that is up and answering
// 500s. The error message ("Publishable key is missing") appears only in the
// process log, which nothing is watching at 2am.
//
// A missing credential must therefore be fatal AT BOOT, before the port is
// bound, so a bad deploy fails visibly and the previous revision keeps serving
// instead of being replaced by a running-but-broken one. All of them are
// listed in one place so adding a dependency on a new secret means adding a
// line here, not discovering it in production.
//
// Names and reasons are kept together because the reason is the useful half
// when this fires — the person reading it is looking at a deploy that will not
// start and needs to know what to paste into Replit Secrets, not just a key
// name to search the codebase for.
const REQUIRED_ENV: { name: string; why: string }[] = [
  { name: "CLERK_SECRET_KEY", why: "verifies session tokens server-side (dashboard.clerk.com > API Keys)" },
  { name: "CLERK_PUBLISHABLE_KEY", why: "clerkMiddleware needs it to resolve the Frontend API — without it EVERY request 500s" },
  { name: "DATABASE_URL", why: "Postgres connection string; lib/db throws on import without it" },
  { name: "CONNECTOR_ENCRYPTION_KEY", why: "32 bytes hex/base64; AES-256-GCM key for OAuth tokens at rest (lib/crypto.ts)" },
];

// Not fatal, but each one silently disables a whole feature, and a feature that
// is off because a secret was never set looks identical to a feature that is
// broken. Logged loudly at boot so the answer to "why does Vera say it can't
// think" is in the first ten lines of the log rather than in a support thread.
const OPTIONAL_ENV: { name: string; whatBreaks: string }[] = [
  { name: "GROQ_API_KEY", whatBreaks: "all AI answers fall back to the canned no-model response" },
  { name: "FRONTEND_URL", whatBreaks: "OAuth connector callbacks redirect to a relative path and land nowhere" },
  { name: "STRIPE_SECRET_KEY", whatBreaks: "billing stays off — the product runs free-only, which is the correct default until BILLING_ENABLED is a deliberate decision" },
  { name: "STRIPE_WEBHOOK_SECRET", whatBreaks: "Stripe webhook events are rejected, so a completed checkout never updates the subscription row" },
];

const missingRequired = REQUIRED_ENV.filter((v) => !process.env[v.name]?.trim());

if (missingRequired.length > 0) {
  throw new Error(
    `Refusing to start — ${missingRequired.length} required environment variable(s) are not set:\n` +
      missingRequired.map((v) => `  - ${v.name}: ${v.why}`).join("\n") +
      "\n\nSet them in Replit Secrets (or a local .env) — see artifacts/api-server/.env.example for the full list.",
  );
}

for (const v of OPTIONAL_ENV) {
  if (!process.env[v.name]?.trim()) {
    logger.warn({ envVar: v.name }, `${v.name} is not set — ${v.whatBreaks}`);
  }
}

// Not fatal, because the product runs fine without an operator — but it is the
// difference between being able to suspend an abusive account and not, so it
// should never be discovered mid-incident. Unset means NOBODY has operator
// access (see middlewares/auth.ts for why the default is closed).
if (operatorCount() === 0) {
  logger.warn(
    "OPERATOR_USER_IDS is not set — nobody can reach /api/operator/*, so there is no way to suspend an account, read the security trail, or revoke a session from inside Vera. Set it to your own Clerk user id (user_…) before external users.",
  );
} else {
  logger.info({ operators: operatorCount() }, "Operator access is configured");
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

// ---- Stripe webhook: registered before CORS, CSRF and the JSON body parser ----
//
// THREE THINGS THAT WOULD EACH BREAK THIS IF IT WERE MOUNTED WITH EVERYTHING
// ELSE. Stripe calls this server-to-server, so it sends no Origin header
// sameOriginOnly would accept and no Authorization Bearer token either — it
// would be rejected as a forged cross-site write by the same guard that
// protects every other POST. It also sends a body whose exact bytes must
// survive to stripe.webhooks.constructEvent() for the signature check;
// express.json() parses and re-serialising it would not reproduce what Stripe
// actually signed. So this route gets its own raw-body parser and is
// registered ahead of both — the signature check inside stripeWebhookHandler
// is what authenticates the caller instead, and it is a stronger guarantee
// than an Origin check: it proves the body is unmodified Stripe output, not
// just that the request came from an allowed page.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

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
    const key = userOrIpKey(req);
    logger.warn({ limiter: limiterName, key, path: req.path, method: req.method }, "Rate limit exceeded");
    // Also written to audit_events, which is the half that survives a restart.
    // The pino line is for tailing the log now; the row is for answering "which
    // account was hammering us on Tuesday" a week later, from the operator
    // surface, without a database shell. Never the body — just which limiter,
    // which key, which route.
    void recordAuditEvent({
      eventType: "abuse.rate_limited",
      userId: getAuth(req)?.userId ?? null,
      subject: key,
      route: req.path,
      severity: "warn",
      metadata: { limiter: limiterName, method: req.method },
    });
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

// ---- The one control that turns Vera off without a developer ----
//
// THE GAP THIS CLOSES. There was no way to stop the product. Not a flag, not a
// route, not a column — if a founder had to take Vera down mid-incident (a
// leaked key, an abusive account burning the Groq quota, a bad answer going out
// to every user) the only available action was to delete the deployment, which
// also destroys the URL and gives every user a connection error with no
// explanation.
//
// VERA_MAINTENANCE_MODE=on refuses every /api call with a 503 and a sentence a
// founder can read, EXCEPT the health endpoints — those must keep answering or
// the uptime monitor reports an outage during a deliberate maintenance window
// and the one alert that matters gets trained into noise.
//
// An env var rather than a database row on purpose: the case this exists for
// includes "the database is the thing that is broken", and a kill switch that
// needs a working DB to read is not a kill switch. Flipping it is Replit
// Secrets + restart — no code change, no deploy, no developer.
//
// 503 + Retry-After is the correct pair: it tells crawlers and clients this is
// temporary, where a 500 would say the server is broken and a 404 would say
// Vera no longer exists.
const MAINTENANCE_MODE = /^(1|true|on|yes)$/i.test(process.env.VERA_MAINTENANCE_MODE ?? "");

if (MAINTENANCE_MODE) {
  logger.warn("VERA_MAINTENANCE_MODE is on — all /api routes except health checks will answer 503");
}

app.use("/api", (req, res, next) => {
  if (!MAINTENANCE_MODE) return next();
  if (req.path === "/healthz" || req.path === "/readyz") return next();
  res.setHeader("Retry-After", "600");
  res.status(503).json({
    error:
      process.env.VERA_MAINTENANCE_MESSAGE?.trim() ||
      "Vera is down for maintenance right now. Nothing you've saved is affected — please try again shortly.",
  });
});

// Health endpoints are exempt from the global limiter, and that exemption is
// load-bearing rather than a convenience. These two are what an external uptime
// monitor polls; leaving them behind a 240/min per-IP bucket meant a monitor
// sharing an egress IP with any other traffic could be throttled into reporting
// a false outage — an alert channel that cries wolf is worse than none. They are
// two constant-cost handlers (one returns a literal, one runs SELECT 1 with a
// 3s timeout), so there is nothing here worth rationing.
app.use("/api", (req, res, next) => {
  if (req.path === "/healthz" || req.path === "/readyz") return next();
  return globalLimiter(req, res, next);
});
app.use(["/api/ai", "/api/actions", "/api/attachments"], expensiveLimiter);
app.use(["/api/ai", "/api/actions"], dailyModelCallLimiter);

app.use("/api", router);

// ---- Unmatched /api paths must answer JSON, like every other route here ----
//
// Without this, an unknown path falls through to Express's built-in
// finalhandler, which renders an HTML page ("Cannot GET /api/whatever"). Every
// caller in the frontend — apiFetch in venusApi.ts and the generated client
// alike — reads the body with response.json() on a non-ok response, so an HTML
// 404 throws inside the error path and the founder is shown a generic
// "Request failed" instead of the real status. Verified against the running
// server: GET /api/does-not-exist returned text/html before this.
//
// It also stops the default page advertising the framework and echoing the
// requested path back into a rendered document.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} /api${req.path.replace(/[^\w/:.-]/g, "")}` });
});

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

  // A malformed JSON body is the one 4xx whose message is NOT founder-readable
  // text written at a throw site — it is body-parser's own parse error, and it
  // was reaching callers verbatim ("Expected property name or '}' in JSON at
  // position 1"). Harmless in content, but it is a library's internal string
  // rather than anything a caller can act on, and returning it made the 4xx
  // rule ("deliberate, readable messages pass through") quietly untrue. Named
  // by err.type, which body-parser sets, rather than by sniffing the text.
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "That request body isn't valid JSON." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "That request is too large." });
  }

  const message = status < 500 && typeof err?.message === "string" ? err.message : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
