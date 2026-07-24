const SLACK_API_BASE = "https://slack.com/api";

async function slackFetch(accessToken: string, method: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`Slack API ${method} failed: ${data.error ?? "unknown error"}`);
  return data;
}

export interface UnreadDm {
  channelId: string;
  fromUser: string;
  text: string;
}

// Slack has no single "list unread" endpoint the way Gmail does — this
// approximates it: list DM channels, pull each one's most recent message,
// and treat "last message wasn't sent by the bot's own auth user, within
// the last 24h" as unread-worthy. Good enough for a "surface what needs a
// reply" connector; not a byte-for-byte unread-count implementation.
export async function listUnreadDms(accessToken: string, maxChannels = 10): Promise<UnreadDm[]> {
  const auth = await slackFetch(accessToken, "auth.test");
  const selfUserId = auth.user_id as string;

  const channels = await slackFetch(accessToken, "conversations.list", { types: "im", limit: String(maxChannels) });
  const oneDayAgo = (Date.now() / 1000 - 24 * 60 * 60).toString();

  const results: UnreadDm[] = [];
  for (const channel of channels.channels ?? []) {
    const history = await slackFetch(accessToken, "conversations.history", { channel: channel.id, limit: "1", oldest: oneDayAgo });
    const lastMessage = history.messages?.[0];
    if (!lastMessage || lastMessage.user === selfUserId) continue;

    const userInfo = await slackFetch(accessToken, "users.info", { user: lastMessage.user }).catch(() => null);
    results.push({
      channelId: channel.id,
      fromUser: userInfo?.user?.real_name ?? userInfo?.user?.name ?? lastMessage.user,
      text: lastMessage.text ?? "",
    });
  }
  return results;
}

export async function postMessage(accessToken: string, channelId: string, text: string): Promise<void> {
  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error ?? "unknown error"}`);
}
