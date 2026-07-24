const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
}

function extractTitle(page: any): string {
  const titleProp = Object.values(page.properties ?? {}).find((p: any) => p.type === "title") as any;
  const text = titleProp?.title?.map((t: any) => t.plain_text).join("") ?? "";
  return text || "(untitled page)";
}

// Recently-edited pages, newest first — the closest Notion equivalent to
// "what's new since last time" without requiring the founder to configure
// a specific database up front.
export async function listRecentlyEditedPages(accessToken: string, maxResults = 10): Promise<NotionPage[]> {
  const res = await fetch(`${NOTION_API_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: maxResults,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Notion search failed: ${res.status} ${body}`);
  }
  const data: any = await res.json();
  return (data.results ?? []).map((page: any) => ({
    id: page.id,
    title: extractTitle(page),
    url: page.url,
    lastEditedTime: page.last_edited_time,
  }));
}
