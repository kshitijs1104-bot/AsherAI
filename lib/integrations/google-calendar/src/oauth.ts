import { getGoogleAuthUrl, exchangeGoogleCode, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokens } from "@workspace/integration-google-oauth";

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

export type CalendarTokens = GoogleTokens;

export function getCalendarAuthUrl(redirectUri: string, state: string): string {
  return getGoogleAuthUrl(redirectUri, state, CALENDAR_SCOPES);
}

export const exchangeCalendarCode = exchangeGoogleCode;
export const refreshCalendarAccessToken = refreshGoogleAccessToken;
export const revokeCalendarToken = revokeGoogleToken;
