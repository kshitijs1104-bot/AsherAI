import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "./middlewares/auth";

if (!process.env["CLERK_SECRET_KEY"]) {
  throw new Error(
    "CLERK_SECRET_KEY environment variable is required but was not provided. " +
      "Set it in your Replit Secrets — see artifacts/api-server/.env.example.",
  );
}

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
app.set("trust proxy", 1);

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
// TODO: lock down before production — set ALLOWED_ORIGIN to your Vercel deployment URL.
// CORS must be registered before any routes so preflight (OPTIONS) requests are
// handled for every endpoint, including the AI POST routes.
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-session-id", "x-groq-api-key"],
    credentials: false,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Reads and verifies the Clerk session token on every request (Authorization
// header or __session cookie) and makes it available via getAuth(req) in any
// downstream handler. Does not reject unauthenticated requests on its own —
// routes that must be signed-in use requireAuth from ./middlewares/auth.
app.use(clerkMiddleware());

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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  req.log?.error(err, "Unhandled error");
  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 500;
  res.status(status).json({ error: err?.message || "Internal server error" });
});

export default app;
