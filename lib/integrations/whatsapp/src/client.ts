import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWhatsappMcpServer } from "./server";

export interface WhatsappClient {
  sendMessage(to: string, body: string): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

export async function createWhatsappClient(phoneNumberId: string, permanentToken: string): Promise<WhatsappClient> {
  const server = createWhatsappMcpServer(phoneNumberId, permanentToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-whatsapp-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`WhatsApp MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    sendMessage: (to, body) => callTool<{ messageId: string }>("send_message", { to, body }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
