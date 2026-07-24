import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCalendarMcpServer } from "./server";
import type { ScheduleConflict } from "./calendarApi";

export interface CalendarClient {
  listUpcomingConflicts(): Promise<ScheduleConflict[]>;
  close(): Promise<void>;
}

export async function createCalendarClient(getAccessToken: () => Promise<string>): Promise<CalendarClient> {
  const server = createCalendarMcpServer(getAccessToken);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-google-calendar-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Calendar MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    listUpcomingConflicts: () => callTool<ScheduleConflict[]>("list_upcoming_conflicts", {}),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
