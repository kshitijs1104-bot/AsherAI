import { getGoogleAuthUrl, exchangeGoogleCode, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokens } from "@workspace/integration-google-oauth";

// Thin, Gmail-specific wrapper over the shared Google OAuth helper (see
// lib/integrations/google-oauth) — this connector's only job is supplying
// its own scopes and naming. Calendar and Sheets follow the identical
// shape against the SAME Google Cloud OAuth app.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

export type GmailTokens = GoogleTokens;

export function getGmailAuthUrl(redirectUri: string, state: string): string {
  return getGoogleAuthUrl(redirectUri, state, GMAIL_SCOPES);
}

export const exchangeGmailCode = exchangeGoogleCode;
export const refreshGmailAccessToken = refreshGoogleAccessToken;
export const revokeGmailToken = revokeGoogleToken;
