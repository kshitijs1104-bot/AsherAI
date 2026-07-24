import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import { db, connectorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { encryptToken, decryptToken } from "../lib/crypto";
import { CONNECTOR_REGISTRY, getConnectorMeta } from "../lib/connectors/registry";
import { pollConnector } from "../lib/connectors/poll";
import { OAUTH_ADAPTERS } from "../lib/connectors/oauth";

const router = Router();

const OAUTH_STATE_COOKIE = "ve_oauth_state";

// The redirect_uri handed to the provider AND later replayed at token
// exchange — the two must match each other byte-for-byte, and must match
// what's whitelisted in the provider's console, or the flow dies at
// "redirect_uri_mismatch" before the founder ever sees a consent screen.
//
// Reads x-forwarded-proto directly rather than trusting req.protocol alone:
// app.ts sets `trust proxy` (which makes req.protocol correct), but this is
// the one value where getting it wrong silently breaks every connector, so
// it doesn't rely on that setting still being there. Falls back to https for
// any non-localhost host, since a deployed origin is effectively never
// plain http.
function redirectUriFor(type: string, req: any): string {
  const envVar = `${type.toUpperCase()}_REDIRECT_URI`;
  const override = process.env[envVar];
  if (override) return override;

  const host = String(req.get("host") ?? "");
  const forwarded = String(req.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = forwarded || (isLocal ? req.protocol : "https");

  return `${proto}://${host}/api/connectors/${type}/callback`;
}

// Where the browser lands after a successful/failed OAuth round trip.
// Command Center is an inline view inside /venus (client-side state, see
// Venus.tsx's mainView), not its own route — the ?view=command-center
// query param is how a fresh page load tells it which view to open into,
// since there's no URL for that view to redirect to directly.
function frontendReturnUrl(): string {
  const base = process.env.FRONTEND_URL ?? "";
  return `${base}/venus?view=command-center`;
}

router.get("/connectors", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const rows = await db.select().from(connectorsTable).where(eq(connectorsTable.userId, userId));
    const byType = new Map(rows.map((r) => [r.type, r]));

    const connectors = CONNECTOR_REGISTRY.map((meta) => {
      const row = byType.get(meta.type);
      return {
        type: meta.type,
        label: meta.label,
        implemented: meta.implemented,
        status: row?.status ?? "disconnected",
        lastSyncedAt: row?.lastSyncedAt ?? null,
        lastError: row?.lastError ?? null,
      };
    });

    return res.json({ connectors });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to load connectors" });
  }
});

// Dispatches through OAUTH_ADAPTERS (see lib/connectors/oauth.ts) instead
// of branching on any one service by name — adding a connector's OAuth
// flow means adding an entry to that map, never touching this route.
router.get("/connectors/:type/auth", requireAuth, async (req, res) => {
  const type = String(req.params.type);
  const meta = getConnectorMeta(type);
  const adapter = OAUTH_ADAPTERS[type];
  if (!meta?.implemented || !adapter) {
    return res.status(404).json({ error: "This connector isn't available yet" });
  }

  // Logged because "redirect_uri_mismatch" is the single most common way
  // this flow fails and the provider never tells you which URI it received
  // — this is the exact string that has to be whitelisted in the provider's
  // console, copyable straight out of the server logs.
  const redirectUri = redirectUriFor(type, req);
  req.log.info({ connector: type, redirectUri }, "connector oauth start");

  const state = randomBytes(16).toString("hex");
  // Standard OAuth CSRF guard: a random value minted only at the start of
  // THIS browser's auth attempt, round-tripped through the provider, and
  // checked again at /callback against the httpOnly cookie — without it,
  // an attacker could feed a victim's browser a callback URL carrying the
  // attacker's own authorization code and link the attacker's account into
  // the victim's session.
  res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
  return res.redirect(adapter.getAuthUrl(redirectUri, state));
});

router.get("/connectors/:type/callback", requireAuth, async (req, res) => {
  const type = String(req.params.type);
  const adapter = OAUTH_ADAPTERS[type];
  if (!adapter) return res.status(404).json({ error: "Unknown connector" });

  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    return res.status(400).json({ error: "OAuth state mismatch — please try connecting again" });
  }

  try {
    const userId = requireUserId(req);
    const tokens = await adapter.exchangeCode(code, redirectUriFor(type, req));

    await db
      .insert(connectorsTable)
      .values({ userId, type, status: "connected", oauthTokenRef: encryptToken(JSON.stringify(tokens)) })
      .onConflictDoUpdate({
        target: [connectorsTable.userId, connectorsTable.type],
        set: { status: "connected", oauthTokenRef: encryptToken(JSON.stringify(tokens)), lastError: null, updatedAt: new Date() },
      });

    return res.redirect(frontendReturnUrl());
  } catch (err) {
    req.log.error(err);
    return res.redirect(`${frontendReturnUrl()}?connectorError=${type}`);
  }
});

// WhatsApp isn't OAuth — the founder already holds a permanent access
// token + phone number id from their own Meta Business console (see
// lib/integrations/whatsapp), so this just stores what they paste in,
// same encrypted-at-rest treatment as a real OAuth token gets.
const WhatsappConfigBody = z.object({ phoneNumberId: z.string().min(1), permanentToken: z.string().min(1) });

router.post("/connectors/whatsapp/config", requireAuth, async (req, res) => {
  const body = WhatsappConfigBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "phoneNumberId and permanentToken are required" });

  try {
    const userId = requireUserId(req);
    const tokenRef = encryptToken(JSON.stringify(body.data));

    await db
      .insert(connectorsTable)
      .values({ userId, type: "whatsapp", status: "connected", oauthTokenRef: tokenRef })
      .onConflictDoUpdate({
        target: [connectorsTable.userId, connectorsTable.type],
        set: { status: "connected", oauthTokenRef: tokenRef, lastError: null, updatedAt: new Date() },
      });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to save WhatsApp configuration" });
  }
});

router.post("/connectors/:type/sync", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const type = String(req.params.type);
    const [connector] = await db
      .select()
      .from(connectorsTable)
      .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.type, type)))
      .limit(1);
    if (!connector || connector.status !== "connected") {
      return res.status(400).json({ error: "Connector isn't connected" });
    }

    const created = await pollConnector(userId, connector);
    return res.json({ created });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

router.delete("/connectors/:type", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const type = String(req.params.type);
    const [connector] = await db
      .select()
      .from(connectorsTable)
      .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.type, type)))
      .limit(1);
    if (!connector) return res.status(404).json({ error: "Connector not found" });

    const adapter = OAUTH_ADAPTERS[type];
    if (adapter?.revoke && connector.oauthTokenRef) {
      await adapter.revoke(JSON.parse(decryptToken(connector.oauthTokenRef)));
    }

    await db.delete(connectorsTable).where(eq(connectorsTable.id, connector.id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
