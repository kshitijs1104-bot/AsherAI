import { Router } from "express";
import { z } from "zod/v4";
import { db, queueItemsTable, connectorsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { getGroqClient } from "../lib/groq";
import { draftText } from "../lib/draftText";
import { publishLinkedinDraft } from "../lib/connectors/sendAction";

const router = Router();

// Instant-Use Actions: zero-onboarding, single-input, single-output tools —
// the founder pastes something in, gets a usable result back immediately.
// No system prompt here reasons about the founder's business context or
// asks a clarifying question first (that's the main Venus chat's job) —
// these exist specifically for the "action -> result, done" path with
// nothing in between.
const ACTION_PROMPTS: Record<string, string> = {
  draft_reply:
    "You draft short, direct replies to a message a busy founder received. Write only the reply body — no subject line, no filler greeting, no sign-off unless natural. 2-5 sentences, plain professional tone.",
  // Was "sell_this" — generic marketing-copy generation, which is both the
  // thing every LLM already does and the thing least connected to a causal
  // analysis product. Repurposed (id kept so no schema/queue migration is
  // needed) into the one quick action that IS Vera's job: take a claim or
  // assumption the founder is about to act on and try to break it.
  sell_this:
    "You pressure-test a claim, plan or assumption a founder is about to act on. Name the single strongest reason it could be wrong, the specific evidence that would settle it either way, and the cheapest test that produces that evidence this week. Be blunt and concrete; never hedge with 'it depends'. No headings, no bullet lists, 4-6 sentences.",
  summarize:
    "You summarize the given text into a short, plain-language report a founder can skim in 10 seconds. 3-5 sentences, lead with the single most important takeaway, no headings or bullet lists.",
  follow_up:
    "You draft a short follow-up message for a founder re-opening a conversation that's gone quiet (a lead, a partner, a candidate). Direct, low-pressure, one clear next step. 2-4 sentences.",
};

const ACTION_TITLES: Record<string, string> = {
  draft_reply: "Reply drafted",
  sell_this: "Assumption pressure-tested",
  summarize: "Summary drafted",
  follow_up: "Follow-up drafted",
};

const RunActionBody = z.object({
  input: z.string().min(1),
  mode: z.enum(["instant", "queue"]),
  // "sell_this" specifically can target LinkedIn instead of a generic queue
  // item — the founder decides at the point of drafting, not after. Requires
  // the LinkedIn connector already connected; accepting the resulting queue
  // item is what actually publishes it (see lib/connectors/sendAction.ts).
  postTo: z.enum(["linkedin"]).optional(),
});

router.post("/actions/:type/run", requireAuth, async (req, res) => {
  const type = String(req.params.type);
  const systemPrompt = ACTION_PROMPTS[type];
  if (!systemPrompt) return res.status(404).json({ error: "Unknown action type" });

  const body = RunActionBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "'input' (string) and 'mode' (instant|queue) are required" });

  try {
    const userId = requireUserId(req);
    const groq = await getGroqClient(userId);
    if (!groq) return res.status(400).json({ error: "No Groq API key configured — add one in Settings" });

    const result = await draftText(groq, systemPrompt, body.data.input);
    if (!result) return res.status(502).json({ error: "Failed to generate a result — try again" });

    if (body.data.mode === "instant") {
      return res.json({ result });
    }

    if (body.data.postTo === "linkedin") {
      const [connector] = await db
        .select({ status: connectorsTable.status })
        .from(connectorsTable)
        .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.type, "linkedin")))
        .limit(1);
      if (!connector || connector.status !== "connected") {
        return res.status(400).json({ error: "Connect LinkedIn first" });
      }
    }

    const [item] = await db
      .insert(queueItemsTable)
      .values({
        userId,
        type,
        source: body.data.postTo === "linkedin" ? "linkedin" : "instant_action",
        title: body.data.postTo === "linkedin" ? "LinkedIn post drafted" : (ACTION_TITLES[type] ?? "Drafted result"),
        body: body.data.input.slice(0, 200),
        draftContent: result,
      })
      .returning();
    return res.json({ queued: true, item });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Action failed" });
  }
});

// Publishes a draft the founder refined in the chat's draft workspace,
// straight to its channel. Separate from /actions/:type/run because nothing
// is being generated here — the text is already exactly what the founder
// approved, and re-running it through the model would silently publish
// something they hadn't read.
const PublishBody = z.object({
  channel: z.enum(["linkedin"]),
  content: z.string().min(1),
});

router.post("/actions/publish", requireAuth, async (req, res) => {
  const body = PublishBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "'channel' (linkedin) and non-empty 'content' are required" });

  try {
    const userId = requireUserId(req);
    const { postId } = await publishLinkedinDraft(userId, body.data.content);

    // Logged as a resolved queue row rather than a pending one: this already
    // happened, so it belongs in the founder's history of what Vera did, not
    // in the list of things still waiting on them.
    await db.insert(queueItemsTable).values({
      userId,
      type: "published_draft",
      source: "linkedin",
      title: "LinkedIn post published",
      body: body.data.content.slice(0, 200),
      draftContent: body.data.content,
      status: "accepted",
      resolvedAt: new Date(),
    });

    return res.json({ published: true, postId });
  } catch (err) {
    req.log.error(err);
    // getConnector throws a founder-readable message ("linkedin isn't
    // connected — reconnect it to send this."), which the frontend shows
    // verbatim, so don't flatten it into a generic failure.
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to publish" });
  }
});

export default router;
