import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { createPost } from "./linkedinApi";

// Posting-only — no list/poll tool at all, unlike every other connector
// here. There is nothing to background-poll: LinkedIn's read APIs beyond
// the founder's own basic profile sit behind the gated Marketing Developer
// Platform (see oauth.ts). This connector exists purely to let an accepted
// "sell this"/instant-action draft actually get published.
export function createLinkedinMcpServer(getAccessToken: () => Promise<string>, authorUrn: string): McpServer {
  const server = new McpServer({ name: "vera-linkedin", version: "0.0.0" });

  server.tool(
    "create_post",
    "Publish a text post to the founder's LinkedIn profile — only called when the founder has explicitly accepted a draft.",
    { text: z.string() },
    async ({ text }) => {
      const accessToken = await getAccessToken();
      const result = await createPost(accessToken, authorUrn, text);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}
