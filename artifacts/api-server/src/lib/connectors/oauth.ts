import { getGmailAuthUrl, exchangeGmailCode, refreshGmailAccessToken, revokeGmailToken } from "@workspace/integration-gmail";
import { getCalendarAuthUrl, exchangeCalendarCode, revokeCalendarToken } from "@workspace/integration-google-calendar";
import { getSheetsAuthUrl, exchangeSheetsCode, revokeSheetsToken } from "@workspace/integration-google-sheets";
import { getSlackAuthUrl, exchangeSlackCode, revokeSlackToken } from "@workspace/integration-slack";
import { getNotionAuthUrl, exchangeNotionCode } from "@workspace/integration-notion";
import { getJiraAuthUrl, exchangeJiraCode } from "@workspace/integration-jira";
import { getLinkedinAuthUrl, exchangeLinkedinCode } from "@workspace/integration-linkedin";

// Single dispatch point for "how does THIS connector type do its OAuth
// round trip" — same shape as poll.ts's per-type dispatcher. routes/
// connectors.ts's /auth, /callback, and DELETE handlers all look up an
// adapter by type instead of branching on a literal service name, so
// adding a connector never means touching the route file itself. Tokens
// are passed around as `unknown` here (encrypted as opaque JSON in
// connectors.oauthTokenRef either way) — each connector's own poller is
// what actually knows its token shape.
export interface OAuthAdapter {
  getAuthUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<unknown>;
  revoke?(tokens: any): Promise<void>;
}

export const OAUTH_ADAPTERS: Record<string, OAuthAdapter> = {
  gmail: {
    getAuthUrl: getGmailAuthUrl,
    exchangeCode: exchangeGmailCode,
    revoke: async (tokens) => revokeGmailToken(tokens.refreshToken as string),
  },
  calendar: {
    getAuthUrl: getCalendarAuthUrl,
    exchangeCode: exchangeCalendarCode,
    revoke: async (tokens) => revokeCalendarToken(tokens.refreshToken as string),
  },
  sheets: {
    getAuthUrl: getSheetsAuthUrl,
    exchangeCode: exchangeSheetsCode,
    revoke: async (tokens) => revokeSheetsToken(tokens.refreshToken as string),
  },
  slack: {
    getAuthUrl: getSlackAuthUrl,
    exchangeCode: exchangeSlackCode,
    revoke: async (tokens) => revokeSlackToken(tokens.accessToken as string),
  },
  notion: {
    getAuthUrl: getNotionAuthUrl,
    exchangeCode: exchangeNotionCode,
    // Notion has no revoke endpoint for public OAuth integrations — the
    // founder disconnects on Notion's own "Connections" settings page.
  },
  jira: {
    getAuthUrl: getJiraAuthUrl,
    exchangeCode: exchangeJiraCode,
  },
  linkedin: {
    getAuthUrl: getLinkedinAuthUrl,
    exchangeCode: exchangeLinkedinCode,
  },
};

// Re-exported only so pollers that need a fresh access token can reuse the
// same refresh call the OAuth layer already has — avoids every poller
// re-importing six different integration packages just for this one helper.
export { refreshGmailAccessToken };
