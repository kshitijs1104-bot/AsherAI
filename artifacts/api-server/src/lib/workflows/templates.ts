// Starter templates a founder activates — never a blank canvas. Mirrors
// connectors/registry.ts's shape deliberately: requiredConnectors names
// connector TYPES (see connectors/registry.ts), so the frontend can render
// the exact same "Connect X" affordance inline on a template card instead
// of sending the founder to a separate settings flow. A template whose
// required connector isn't implemented yet (see registry.ts's
// implemented:false entries) simply can't be activated — the card shows
// why instead of silently failing on first run.
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  requiredConnectors: string[];
  defaultCron: string;
  cronLabel: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "gmail-auto-reply",
    name: "Auto-reply drafts from Gmail",
    description: "Checks unread mail and drops a drafted reply into your queue for anything worth a response.",
    requiredConnectors: ["gmail"],
    defaultCron: "*/30 * * * *",
    cronLabel: "Every 30 minutes",
  },
  {
    id: "weekly-decision-followup",
    name: "Weekly decision follow-up",
    description: "Nudges you once a week to report the outcome on your longest-open logged decision.",
    requiredConnectors: [],
    defaultCron: "0 9 * * 1",
    cronLabel: "Mondays at 9am",
  },
  {
    id: "stale-goal-nudge",
    name: "At-risk goal check",
    description: "Flags your riskiest active goal in the queue before it quietly slips further off track.",
    requiredConnectors: [],
    defaultCron: "0 9 * * 1",
    cronLabel: "Mondays at 9am",
  },
  {
    id: "weekly-report-sheets",
    name: "Weekly report from Sheets",
    description: "Summarizes a connected spreadsheet into a short weekly report draft.",
    requiredConnectors: ["sheets"],
    defaultCron: "0 9 * * 1",
    cronLabel: "Mondays at 9am",
  },
];

export function getWorkflowTemplate(templateId: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
}
