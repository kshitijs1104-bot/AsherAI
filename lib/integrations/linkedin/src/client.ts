import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLinkedinMcpServer } from "./server";

export interface LinkedinClient {
  createPost(text: string): Promise<{ postId: string }>;
  close(): Promise<void>;
}

export async function createLinkedinClient(getAccessToken: () => Promise<string>, authorUrn: string): Promise<LinkedinClient> {
  const server = createLinkedinMcpServer(getAccessToken, authorUrn);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-linkedin-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`LinkedIn MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    createPost: (text) => callTool<{ postId: string }>("create_post", { text }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
