import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listUpcomingConflicts } from "./calendarApi";

export function createCalendarMcpServer(getAccessToken: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "vera-google-calendar", version: "0.0.0" });

  server.tool(
    "list_upcoming_conflicts",
    "List overlapping/double-booked calendar events in the founder's next 24 hours.",
    {},
    async () => {
      const accessToken = await getAccessToken();
      const conflicts = await listUpcomingConflicts(accessToken);
      return { content: [{ type: "text", text: JSON.stringify(conflicts) }] };
    },
  );

  return server;
}
