import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listUnreadThreads, createDraftReply } from "./gmailApi";

// The MCP layer for this connector: two tools, both pure Gmail-API access,
// no drafting/AI logic and no queue_items knowledge inside them. Anything
// connector-generic (dedupe, writing a queue item, calling an LLM to
// compose the reply body) lives in api-server's connector poller instead —
// this file's only job is "what can be done against Gmail," so the MCP
// contract stays identical however many other services eventually plug into
// the same poller shape.
export function createGmailMcpServer(getAccessToken: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "vera-gmail", version: "0.0.0" });

  server.tool(
    "list_unread_threads",
    "List the founder's unread Gmail messages (subject, sender, snippet), newest first.",
    { maxResults: z.number().int().min(1).max(25).default(10) },
    async ({ maxResults }) => {
      const accessToken = await getAccessToken();
      const threads = await listUnreadThreads(accessToken, maxResults);
      return { content: [{ type: "text", text: JSON.stringify(threads) }] };
    },
  );

  server.tool(
    "create_draft_reply",
    "Save a drafted reply on a Gmail thread (never sends — the founder still sends it themselves).",
    {
      threadId: z.string(),
      to: z.string(),
      subject: z.string(),
      bodyText: z.string(),
    },
    async ({ threadId, to, subject, bodyText }) => {
      const accessToken = await getAccessToken();
      const result = await createDraftReply(accessToken, { threadId, to, subject, bodyText });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}
