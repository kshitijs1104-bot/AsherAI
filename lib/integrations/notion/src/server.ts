import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listRecentlyEditedPages } from "./notionApi";

export function createNotionMcpServer(getAccessToken: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "vera-notion", version: "0.0.0" });

  server.tool(
    "list_recently_edited_pages",
    "List the founder's most recently edited Notion pages, newest first.",
    { maxResults: z.number().int().min(1).max(25).default(10) },
    async ({ maxResults }) => {
      const accessToken = await getAccessToken();
      const pages = await listRecentlyEditedPages(accessToken, maxResults);
      return { content: [{ type: "text", text: JSON.stringify(pages) }] };
    },
  );

  return server;
}
