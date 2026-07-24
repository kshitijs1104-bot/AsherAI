import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createJiraMcpServer } from "./server";
import type { JiraIssue } from "./jiraApi";

export interface JiraClient {
  listAssignedIssues(maxResults?: number): Promise<JiraIssue[]>;
  listStaleIssues(maxResults?: number): Promise<JiraIssue[]>;
  close(): Promise<void>;
}

export async function createJiraClient(getAccessToken: () => Promise<string>, cloudId: string): Promise<JiraClient> {
  const server = createJiraMcpServer(getAccessToken, cloudId);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vera-jira-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as any[])?.[0];
    if (!content || content.type !== "text") throw new Error(`Jira MCP tool "${name}" returned no text content`);
    return JSON.parse(content.text) as T;
  }

  return {
    listAssignedIssues: (maxResults = 10) => callTool<JiraIssue[]>("list_assigned_issues", { maxResults }),
    listStaleIssues: (maxResults = 10) => callTool<JiraIssue[]>("list_stale_issues", { maxResults }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
