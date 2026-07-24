import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listAssignedIssues, listStaleIssues } from "./jiraApi";

export function createJiraMcpServer(getAccessToken: () => Promise<string>, cloudId: string): McpServer {
  const server = new McpServer({ name: "vera-jira", version: "0.0.0" });

  server.tool(
    "list_assigned_issues",
    "List the founder's currently assigned, unresolved Jira issues.",
    { maxResults: z.number().int().min(1).max(25).default(10) },
    async ({ maxResults }) => {
      const accessToken = await getAccessToken();
      const issues = await listAssignedIssues(accessToken, cloudId, maxResults);
      return { content: [{ type: "text", text: JSON.stringify(issues) }] };
    },
  );

  server.tool(
    "list_stale_issues",
    "List the founder's assigned issues that haven't been updated in over a week.",
    { maxResults: z.number().int().min(1).max(25).default(10) },
    async ({ maxResults }) => {
      const accessToken = await getAccessToken();
      const issues = await listStaleIssues(accessToken, cloudId, maxResults);
      return { content: [{ type: "text", text: JSON.stringify(issues) }] };
    },
  );

  return server;
}
