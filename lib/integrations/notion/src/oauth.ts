// Notion's public-integration OAuth: a plain authorization-code exchange
// against api.notion.com, Basic-auth'd with the integration's client
// credentials. No refresh token in the response — Notion access tokens for
// OAuth integrations don't expire, so there's no refresh flow to build.
function requireClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NOTION_CLIENT_ID and NOTION_CLIENT_SECRET must be set to use the Notion connector.");
  }
  return { clientId, clientSecret };
}

export function getNotionAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireClientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export interface NotionTokens {
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
}

export async function exchangeNotionCode(code: string, redirectUri: string): Promise<NotionTokens> {
  const { clientId, clientSecret } = requireClientCreds();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Notion OAuth exchange failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  return { accessToken: data.access_token, workspaceId: data.workspace_id ?? "", workspaceName: data.workspace_name ?? "" };
}
