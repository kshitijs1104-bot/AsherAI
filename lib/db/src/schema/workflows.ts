import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A workflow is one founder's activated instance of a starter template (see
// api-server's lib/workflows/registry.ts for the template definitions
// themselves) — never a from-scratch canvas. templateId points back at
// which template this came from so the daily job knows which run function
// to call; name/scheduleCron are copied from the template at creation time
// (not just read live off the template) so a founder's workflow keeps
// working the same way even if a template's defaults change later.
export const workflowsTable = pgTable(
  "workflows",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),

    templateId: text("template_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // active | paused

    // JSON string array of connector types this workflow depends on (e.g.
    // ["gmail"]) — copied from the template so a run can check "are all my
    // connectors still connected" without re-reading the template registry.
    connectorTypesJson: text("connector_types_json").notNull().default("[]"),
    scheduleCron: text("schedule_cron").notNull(),

    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("workflows_user_status_idx").on(table.userId, table.status)],
);

export const insertWorkflowSchema = createInsertSchema(workflowsTable).omit({
  id: true,
  createdAt: true,
  lastRunAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflowsTable.$inferSelect;
