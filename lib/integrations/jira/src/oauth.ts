// Atlassian's OAuth 2.0 (3LO) — a plain authorization-code exchange against
// auth.atlassian.com, PLUS one extra step every other connector here
// doesn't need: a Jira access token isn't scoped to a specific site by
// itself, so exchangeJiraCode also calls the accessible-resources endpoint
// once and bakes the resulting cloudId into the stored tokens — every
// later REST call (see jiraApi.ts) needs that cloudId in its URL path.
const JIRA_SCOPES = ["read:jira-work", "read:jira-user", "offline_access"];

function requireClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("JIRA_CLIENT_ID and JIRA_CLIENT_SECRET must be set to use the Jira connector.");
  }
  return { clientId, clientSecret };
}

export function getJiraAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireClientCreds();
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: JIRA_SCOPES.join(" "),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });
  return `https://auth.atlassian.com/authorize?${params.toString()}`;
}

export interface JiraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  cloudId: string;
  siteUrl: string;
}

async function fetchAccessibleResource(accessToken: string): Promise<{ cloudId: string; siteUrl: string }> {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jira accessible-resources lookup failed: ${res.status}`);
  const resources: any = await res.json();
  // Use the first accessible Jira site — a founder connecting Jira almost
  // always has exactly one site; multi-site selection is a real gap but
  // not one worth a picker UI for a first pass.
  const first = resources[0];
  if (!first) throw new Error("No accessible Jira sites found for this account");
  return { cloudId: first.id, siteUrl: first.url };
}

export async function exchangeJiraCode(code: string, redirectUri: string): Promise<JiraTokens> {
  const { clientId, clientSecret } = requireClientCreds();
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira OAuth exchange failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  const { cloudId, siteUrl } = await fetchAccessibleResource(data.access_token);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    cloudId,
    siteUrl,
  };
}

export async function refreshJiraAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const { clientId, clientSecret } = requireClientCreds();
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Jira token refresh failed: ${res.status}`);
  const data: any = await res.json();
  // Atlassian rotates the refresh token on every use — the OLD one becomes
  // invalid immediately, so callers must persist the new one, not just the
  // new access token.
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}
