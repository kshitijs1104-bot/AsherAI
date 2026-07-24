import type { Connector } from "@workspace/db";
import { pollGmailConnector } from "./gmail";
import { pollCalendarConnector } from "./calendar";
import { pollSheetsConnector } from "./sheets";
import { pollSlackConnector } from "./slack";
import { pollNotionConnector } from "./notion";
import { pollJiraConnector } from "./jira";

// The one place that maps a connector "type" string to its actual poll
// implementation. Every caller (the connectors routes' manual sync, the
// daily background job) calls this instead of switching on type itself —
// adding a real connector later means adding one case here, not touching
// every call site.
//
// LinkedIn and WhatsApp are deliberately absent: both are posting-only
// (see their integration packages) — there's nothing to poll, only a
// send action triggered directly from an accepted queue item/instant
// action, never from a background sync.
export async function pollConnector(userId: string, connector: Connector): Promise<number> {
  switch (connector.type) {
    case "gmail":
      return pollGmailConnector(userId, connector);
    case "calendar":
      return pollCalendarConnector(userId, connector);
    case "sheets":
      return pollSheetsConnector(userId, connector);
    case "slack":
      return pollSlackConnector(userId, connector);
    case "notion":
      return pollNotionConnector(userId, connector);
    case "jira":
      return pollJiraConnector(userId, connector);
    case "linkedin":
    case "whatsapp":
      throw new Error(`"${connector.type}" is a posting-only connector and has nothing to sync.`);
    default:
      throw new Error(`No poll implementation registered for connector type "${connector.type}"`);
  }
}
