import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { sendMessage } from "./whatsappApi";

export function createWhatsappMcpServer(phoneNumberId: string, permanentToken: string): McpServer {
  const server = new McpServer({ name: "vera-whatsapp", version: "0.0.0" });

  server.tool(
    "send_message",
    "Send a WhatsApp text message via the founder's connected Business phone number.",
    { to: z.string(), body: z.string() },
    async ({ to, body }) => {
      const result = await sendMessage(phoneNumberId, permanentToken, to, body);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}
