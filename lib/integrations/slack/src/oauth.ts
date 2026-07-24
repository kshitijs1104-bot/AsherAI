// Slack's OAuth v2 is a plain REST token exchange, not the Google OAuth2Client
// shape — hand-rolled with fetch, same "no heavy SDK for one endpoint"
// posture as every other connector here.
const SLACK_SCOPES = ["channels:history", "im:history", "im:read", "chat:write", "users:read"];

function requireClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set to use the Slack connector.");
  }
  return { clientId, clientSecret };
}

export function getSlackAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireClientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackTokens {
  accessToken: string;
  teamId: string;
  teamName: string;
}

export async function exchangeSlackCode(code: string, redirectUri: string): Promise<SlackTokens> {
  const { clientId, clientSecret } = requireClientCreds();
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const data: any = await res.json();
  if (!data.ok || !data.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${data.error ?? "unknown error"}`);
  }
  return { accessToken: data.access_token, teamId: data.team?.id ?? "", teamName: data.team?.name ?? "" };
}

// Slack bot tokens issued by oauth.v2.access don't expire by default (no
// refresh_token in the response) — nothing to refresh, unlike the Google
// connectors. Kept as a no-op export so the OAuth adapter map (see
// api-server's lib/connectors/oauth.ts) has a consistent revoke() shape.
export async function revokeSlackToken(accessToken: string): Promise<void> {
  try {
    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // best-effort — disconnect must still remove the local row regardless
  }
}
