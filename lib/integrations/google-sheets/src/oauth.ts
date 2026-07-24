import { getGoogleAuthUrl, exchangeGoogleCode, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokens } from "@workspace/integration-google-oauth";

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

export type SheetsTokens = GoogleTokens;

export function getSheetsAuthUrl(redirectUri: string, state: string): string {
  return getGoogleAuthUrl(redirectUri, state, SHEETS_SCOPES);
}

export const exchangeSheetsCode = exchangeGoogleCode;
export const refreshSheetsAccessToken = refreshGoogleAccessToken;
export const revokeSheetsToken = revokeGoogleToken;
