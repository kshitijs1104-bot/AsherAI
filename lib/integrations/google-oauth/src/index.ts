import { OAuth2Client } from "google-auth-library";

// Shared by every Google-backed connector (Gmail, Calendar, Sheets) — they
// are all scopes on the SAME Google Cloud OAuth app (one GOOGLE_CLIENT_ID/
// SECRET pair), so the client-credential handling, token exchange, refresh,
// and revoke logic only needs to exist once. Each connector package supplies
// its own scope list and REST wrapper; this package knows nothing about
// Gmail/Calendar/Sheets specifically.
function client(redirectUri: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use any Google-backed connector.");
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export function getGoogleAuthUrl(redirectUri: string, state: string, scopes: string[]): string {
  return client(redirectUri).generateAuthUrl({
    access_type: "offline",
    // Forces a refresh_token even for a founder who authorized a DIFFERENT
    // Google-backed connector (or this one) before — each scope grant is
    // independent, and without this, a second connector's consent screen
    // can come back with no refresh_token at all if Google decides consent
    // was "already given."
    prompt: "consent",
    scope: scopes,
    state,
  });
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const { tokens } = await client(redirectUri).getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google did not return a refresh_token — reconnect and approve access again.");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ?? Date.now() + 55 * 60 * 1000,
  };
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2 = client("");
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Google refresh did not return an access_token — the refresh token may have been revoked.");
  }
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date ?? Date.now() + 55 * 60 * 1000,
  };
}

// Best-effort, same reasoning as the original Gmail-only version: disconnect
// must remove the local row even if Google's revoke endpoint is unreachable.
export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  try {
    await client("").revokeToken(refreshToken);
  } catch {
    // best-effort, see above
  }
}
