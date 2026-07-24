import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSlackMcpServer } from "./server";
import type { UnreadDm } from "./slackApi";

export interface SlackClient {
  listUnreadDms(maxChannels?: number): Promise<UnreadDm[]>;
  postMessage(channelId: string, text: string): Promise<void>;
  close(): Promise<void>;
}

export async function createSlackClient(getAccessToken: () => Promise<string>): Promise<SlackClient> {
  const server = createSlackMcpServer(getAccessToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-slack-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Slack MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    listUnreadDms: (maxChannels = 10) => callTool<UnreadDm[]>("list_unread_dms", { maxChannels }),
    postMessage: async (channelId, text) => {
      await callTool("post_message", { channelId, text });
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
