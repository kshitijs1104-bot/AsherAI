const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export async function readRange(accessToken: string, spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API read failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  return data.values ?? [];
}
