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

function redirectUriFor(type: string, req: any): string {
  const envVar = `${type.toUpperCase()}_REDIRECT_URI`;
  return process.env[envVar] ?? `${req.protocol}://${req.get("host")}/api/connectors/${type}/callback`;
}

// Where the browser lands after a successful/failed OAuth round trip —
// Command Center is where connector status actually surfaces, so that's
// the natural place to send a founder back to after connecting one.
function frontendReturnUrl(): string {
  return process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/venus/command-center` : "/venus/command-center";
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

  const state = randomBytes(16).toString("hex");
  // Standard OAuth CSRF guard: a random value minted only at the start of
  // THIS browser's auth attempt, round-tripped through the provider, and
  // checked again at /callback against the httpOnly cookie — without it,
  // an attacker could feed a victim's browser a callback URL carrying the
  // attacker's own authorization code and link the attacker's account into
  // the victim's session.
  res.cookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
  return res.redirect(adapter.getAuthUrl(redirectUriFor(type, req), state));
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
