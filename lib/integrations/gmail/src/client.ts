import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGmailMcpServer } from "./server";
import type { UnreadThreadSummary } from "./gmailApi";

// The "MCP client" half of "build as MCP servers/clients internally" — an
// in-process linked-transport pair rather than a spawned subprocess/stdio
// connection, since the server and its only caller live in the same Node
// process (the connector poller). Same tool-call contract either way; if
// this connector is ever run out-of-process, only this file's transport
// changes, not gmailApi.ts, server.ts, or any caller of createGmailClient.
export interface GmailClient {
  listUnreadThreads(maxResults?: number): Promise<UnreadThreadSummary[]>;
  createDraftReply(params: { threadId: string; to: string; subject: string; bodyText: string }): Promise<{ draftId: string }>;
  close(): Promise<void>;
}

export async function createGmailClient(getAccessToken: () => Promise<string>): Promise<GmailClient> {
  const server = createGmailMcpServer(getAccessToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-gmail-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Gmail MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    listUnreadThreads: (maxResults = 10) => callTool<UnreadThreadSummary[]>("list_unread_threads", { maxResults }),
    createDraftReply: (params) => callTool<{ draftId: string }>("create_draft_reply", params),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
