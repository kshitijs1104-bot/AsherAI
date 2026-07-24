import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { readRange } from "./sheetsApi";

export function createSheetsMcpServer(getAccessToken: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "vera-google-sheets", version: "0.0.0" });

  server.tool(
    "read_range",
    "Read a cell range from a spreadsheet the founder has configured for this connector.",
    { spreadsheetId: z.string(), range: z.string() },
    async ({ spreadsheetId, range }) => {
      const accessToken = await getAccessToken();
      const values = await readRange(accessToken, spreadsheetId, range);
      return { content: [{ type: "text", text: JSON.stringify(values) }] };
    },
  );

  return server;
}
