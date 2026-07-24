const GRAPH_API_VERSION = "v21.0";

// No OAuth here — Meta's WhatsApp Cloud API requires the founder to already
// have a Meta Business + verified phone number set up in Meta's own
// console, which produces a permanent access token directly (there is no
// "click Connect and authorize" redirect flow for a personal WhatsApp
// Business number). The founder pastes phoneNumberId + that permanent
// token into a config form instead (see api-server's connectors route) —
// this module just wraps the one REST call needed once those exist.
export async function sendMessage(phoneNumberId: string, permanentToken: string, to: string, body: string): Promise<{ messageId: string }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${permanentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed: ${res.status} ${errBody}`);
  }
  const data: any = await res.json();
  return { messageId: data.messages?.[0]?.id ?? "" };
}
