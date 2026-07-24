import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNotionMcpServer } from "./server";
import type { NotionPage } from "./notionApi";

export interface NotionClient {
  listRecentlyEditedPages(maxResults?: number): Promise<NotionPage[]>;
  close(): Promise<void>;
}

export async function createNotionClient(getAccessToken: () => Promise<string>): Promise<NotionClient> {
  const server = createNotionMcpServer(getAccessToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-notion-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Notion MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    listRecentlyEditedPages: (maxResults = 10) => callTool<NotionPage[]>("list_recently_edited_pages", { maxResults }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
