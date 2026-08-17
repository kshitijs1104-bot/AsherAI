import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// LIVENESS. "This process is running and answering." Deliberately checks
// nothing else — a liveness probe that fails on a dependency outage tells a
// platform to restart a process that is not the broken thing, which turns a
// database blip into a restart loop. Shape is fixed by the OpenAPI contract.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ---- READINESS. "Vera can actually serve a request right now." ----
//
// THE GAP THIS CLOSES. /healthz returns a hardcoded {status:"ok"} and touches
// nothing. Point an uptime monitor at it — which is exactly what it looks like
// it is for — and the monitor reports green while the database is unreachable
// and every single data route is returning 500. The one automated check that
// is supposed to work when nobody is watching was structurally incapable of
// detecting the most likely outage.
//
// This one runs the cheapest possible real query (SELECT 1) against the same
// pool every route uses, with a hard timeout so a hung connection produces a
// fast 503 rather than a probe that itself hangs until the monitor times out
// and reports an ambiguous failure.
//
// 503 on failure, not 500: this is "not ready to serve", which is what makes a
// load balancer stop sending traffic and an uptime monitor page someone. The
// body names WHICH dependency failed so the first thirty seconds of an incident
// are not spent guessing, and it deliberately carries no driver message — the
// detail goes to the log, where the reason belongs and the internet does not.
const READINESS_TIMEOUT_MS = 3000;

router.get("/readyz", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error(`database did not answer within ${READINESS_TIMEOUT_MS}ms`)), READINESS_TIMEOUT_MS),
      ),
    ]);
    res.json({ status: "ok", checks: { database: "ok" }, latencyMs: Date.now() - startedAt });
  } catch (err) {
    logger.error({ err, latencyMs: Date.now() - startedAt }, "Readiness check failed — database unreachable");
    res.status(503).json({
      status: "unavailable",
      checks: { database: "failed" },
      latencyMs: Date.now() - startedAt,
    });
  }
});

export default router;
