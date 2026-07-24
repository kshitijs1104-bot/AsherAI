// Single source of truth for "what connectors exist" — routes/connectors.ts,
// the daily job, and the frontend connector list all read this instead of
// each hardcoding their own list of service names. Adding a new connector
// that's actually wired up means: write its lib/integrations/<name> package,
// add one entry here with implemented:true and a poll function, done —
// nothing else in this file, the routes, or the frontend needs a per-service
// branch.
export interface ConnectorMeta {
  type: string;
  label: string;
  implemented: boolean;
}

export const CONNECTOR_REGISTRY: ConnectorMeta[] = [
  { type: "gmail", label: "Gmail", implemented: true },
  { type: "slack", label: "Slack", implemented: true },
  { type: "calendar", label: "Google Calendar", implemented: true },
  { type: "sheets", label: "Google Sheets", implemented: true },
  { type: "notion", label: "Notion", implemented: true },
  { type: "jira", label: "Jira", implemented: true },
  { type: "linkedin", label: "LinkedIn", implemented: true },
  // WhatsApp isn't an OAuth connector like the rest — see routes/connectors.ts's
  // dedicated /whatsapp/config route (frontend ConnectorChip renders a
  // config-form variant for it instead of the OAuth "Connect" button).
  { type: "whatsapp", label: "WhatsApp Business", implemented: true },
];

export function getConnectorMeta(type: string): ConnectorMeta | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.type === type);
}
