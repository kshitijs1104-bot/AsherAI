import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listUnreadDms, postMessage } from "./slackApi";

export function createSlackMcpServer(getAccessToken: () => Promise<string>): McpServer {
  const server = new McpServer({ name: "vera-slack", version: "0.0.0" });

  server.tool(
    "list_unread_dms",
    "List the founder's recent unreplied Slack DMs.",
    { maxChannels: z.number().int().min(1).max(25).default(10) },
    async ({ maxChannels }) => {
      const accessToken = await getAccessToken();
      const dms = await listUnreadDms(accessToken, maxChannels);
      return { content: [{ type: "text", text: JSON.stringify(dms) }] };
    },
  );

  server.tool(
    "post_message",
    "Send a message into a Slack DM channel — used to send an accepted drafted reply, never called automatically.",
    { channelId: z.string(), text: z.string() },
    async ({ channelId, text }) => {
      const accessToken = await getAccessToken();
      await postMessage(accessToken, channelId, text);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  return server;
}
