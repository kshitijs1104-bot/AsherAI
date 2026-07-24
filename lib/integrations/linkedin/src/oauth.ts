// LinkedIn's "Sign In with LinkedIn using OpenID Connect" + "Share on
// LinkedIn" products (both free, self-serve) — posting-only, deliberately:
// anything beyond profile + posting (reading the feed, messages, analytics)
// sits behind LinkedIn's Marketing Developer Platform partner review,
// which is a multi-week/month manual approval process not worth building
// against for this connector's scope.
const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

function requireClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set to use the LinkedIn connector.");
  }
  return { clientId, clientSecret };
}

export function getLinkedinAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireClientCreds();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export interface LinkedinTokens {
  accessToken: string;
  // Only present if the app has the refresh-token product enabled — access
  // tokens last 60 days regardless, so a founder who reconnects every
  // couple months works fine even without it.
  refreshToken: string | null;
  expiresAt: number;
  authorUrn: string; // "urn:li:person:<id>" — required on every post
}

async function fetchAuthorUrn(accessToken: string): Promise<string> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo lookup failed: ${res.status}`);
  const data: any = await res.json();
  return `urn:li:person:${data.sub}`;
}

export async function exchangeLinkedinCode(code: string, redirectUri: string): Promise<LinkedinTokens> {
  const { clientId, clientSecret } = requireClientCreds();
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LinkedIn OAuth exchange failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  const authorUrn = await fetchAuthorUrn(data.access_token);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
    authorUrn,
  };
}
