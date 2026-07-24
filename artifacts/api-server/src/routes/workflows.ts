import { Router } from "express";
import { z } from "zod/v4";
import { db, workflowsTable, connectorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { WORKFLOW_TEMPLATES, getWorkflowTemplate } from "../lib/workflows/templates";
import { runWorkflow } from "../lib/workflows/runners";

const router = Router();

// Templates + activation state in one read so a template card can render
// its "Connect X" affordance inline (see section 5's "one-click connector
// wiring, not a separate settings flow") without a second round trip.
router.get("/workflows/templates", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const [activeWorkflows, connectors] = await Promise.all([
      db.select({ templateId: workflowsTable.templateId }).from(workflowsTable).where(eq(workflowsTable.userId, userId)),
      db.select().from(connectorsTable).where(eq(connectorsTable.userId, userId)),
    ]);
    const activatedIds = new Set(activeWorkflows.map((w) => w.templateId));
    const connectedTypes = new Set(connectors.filter((c) => c.status === "connected").map((c) => c.type));

    const templates = WORKFLOW_TEMPLATES.map((t) => ({
      ...t,
      activated: activatedIds.has(t.id),
      connectorsReady: t.requiredConnectors.every((c) => connectedTypes.has(c)),
    }));
    return res.json({ templates });
  } catch (err) {
    req.log.error(err);
    // Real message (e.g. "relation workflows does not exist" pre-migration)
    // rather than a canned string — this exact failure mode is what showed
    // up to a founder as a silently empty template list with no way to
    // tell why, so the specific reason needs to actually reach the UI.
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load workflow templates" });
  }
});

router.get("/workflows", requireAuth, async (req, res) => {
  try {
    const userId = requireUserId(req);
    const rows = await db.select().from(workflowsTable).where(eq(workflowsTable.userId, userId));
    return res.json({ workflows: rows });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load workflows" });
  }
});

const ActivateBody = z.object({ templateId: z.string() });

router.post("/workflows", requireAuth, async (req, res) => {
  const body = ActivateBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "templateId is required" });

  const template = getWorkflowTemplate(body.data.templateId);
  if (!template) return res.status(404).json({ error: "Unknown workflow template" });

  try {
    const userId = requireUserId(req);

    if (template.requiredConnectors.length > 0) {
      const connectors = await db
        .select()
        .from(connectorsTable)
        .where(eq(connectorsTable.userId, userId));
      const connectedTypes = new Set(connectors.filter((c) => c.status === "connected").map((c) => c.type));
      const missing = template.requiredConnectors.filter((c) => !connectedTypes.has(c));
      if (missing.length > 0) {
        return res.status(400).json({ error: `Connect ${missing.join(", ")} first`, missingConnectors: missing });
      }
    }

    const [workflow] = await db
      .insert(workflowsTable)
      .values({
        userId,
        templateId: template.id,
        name: template.name,
        status: "active",
        connectorTypesJson: JSON.stringify(template.requiredConnectors),
        scheduleCron: template.defaultCron,
      })
      .returning();
    return res.json({ workflow });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to activate workflow" });
  }
});

const UpdateStatusBody = z.object({ status: z.enum(["active", "paused"]) });

router.patch("/workflows/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid workflow id" });

  const body = UpdateStatusBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "status must be active or paused" });

  try {
    const userId = requireUserId(req);
    const [updated] = await db
      .update(workflowsTable)
      .set({ status: body.data.status })
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Workflow not found" });
    return res.json({ workflow: updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to update workflow" });
  }
});

router.delete("/workflows/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid workflow id" });

  try {
    const userId = requireUserId(req);
    const deleted = await db
      .delete(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .returning({ id: workflowsTable.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Workflow not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Failed to remove workflow" });
  }
});

// Manual "run now" — the same function call the daily job makes for a due
// workflow, exposed here so a founder gets instant proof a newly-activated
// workflow actually works instead of waiting for its first scheduled tick.
router.post("/workflows/:id/run", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid workflow id" });

  try {
    const userId = requireUserId(req);
    const [workflow] = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .limit(1);
    if (!workflow) return res.status(404).json({ error: "Workflow not found" });

    const created = await runWorkflow(userId, workflow);
    await db.update(workflowsTable).set({ lastRunAt: new Date() }).where(eq(workflowsTable.id, id));
    return res.json({ created });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Workflow run failed" });
  }
});

export default router;
