import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSheetsMcpServer } from "./server";

export interface SheetsClient {
  readRange(spreadsheetId: string, range: string): Promise<string[][]>;
  close(): Promise<void>;
}

export async function createSheetsClient(getAccessToken: () => Promise<string>): Promise<SheetsClient> {
  const server = createSheetsMcpServer(getAccessToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-google-sheets-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Sheets MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    readRange: (spreadsheetId, range) => callTool<string[][]>("read_range", { spreadsheetId, range }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
