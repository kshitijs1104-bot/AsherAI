import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import settingsRouter from "./settings";
import chatsRouter from "./chats";
import goalsRouter from "./goals";
import companyFactsRouter from "./companyFacts";
import roadmapsRouter from "./roadmaps";
import dailyBriefRouter from "./dailyBrief";
import queueRouter from "./queue";
import connectorsRouter from "./connectors";
import actionsRouter from "./actions";
import workflowsRouter from "./workflows";
import recapsRouter from "./recaps";
import attachmentsRouter from "./attachments";
import dossierRouter from "./dossier";
import accountRouter from "./account";
import operatorRouter from "./operator";
import profileRouter from "./profile";
import nudgesRouter from "./nudges";
import accessRouter from "./access";
import billingRouter from "./billing";

// ---- Every route registered here is reachable from the live product ----
//
// SIX ROUTERS WERE REMOVED FROM THIS FILE (thoughts, events, reports,
// companies, signals, stocks) along with their route files. They were the
// backend half of the pre-Vera "Nexus" product — the Line/Sight/Crypt/
// Thoughts terminal — whose frontend already moved to vera-nexus/src/_archive
// and is not reachable from App.tsx's router. Nothing in the live app called
// any of them.
//
// They were not harmless dead weight. Between them they carried the only
// unauthenticated write endpoints in the server (POST/DELETE /thoughts could
// be called by anyone with the URL, with no ownership check on the delete),
// the last three uses of the `req.ip`-as-identity pattern that
// middlewares/auth.ts exists to have eliminated, and three of the four
// `x-groq-api-key` header backdoors. Deleting them removes that entire class
// of exposure rather than guarding it route by route.
//
// The rule this encodes: a route that no live screen calls does not get to
// stay registered. It cannot be tested by using the product, so it drifts out
// of sync with the security model the rest of the server follows — which is
// exactly what happened here.
const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(settingsRouter);
router.use(chatsRouter);
router.use(goalsRouter);
router.use(companyFactsRouter);
router.use(roadmapsRouter);
router.use(dailyBriefRouter);
router.use(queueRouter);
router.use(connectorsRouter);
router.use(actionsRouter);
router.use(workflowsRouter);
router.use(recapsRouter);
router.use(attachmentsRouter);
router.use(dossierRouter);
// DELETE /account. Registered because the privacy policy grants a right to
// erasure, and a granted right with no endpoint behind it is a promise that
// depends on someone hand-writing SQL across fifteen tables.
router.use(accountRouter);
// /operator/*. The one router here that is NOT for end users — it is how the
// founder suspends an account, reads the security trail and revokes a session
// without a database shell. Guarded inside the router itself (requireAuth +
// requireOperator applied to the whole mount), and it answers 404 rather than
// 403 to anyone not on the OPERATOR_USER_IDS allowlist, so its existence is not
// confirmable by probing. See the header of routes/operator.ts for the three
// rules it follows — chief among them that it never returns user content.
router.use(operatorRouter);
// GET/PATCH /profile and POST /profile/onboarding. The onboarding form used to
// write its five answers to localStorage and nowhere else, so the one screen
// that asks every founder who they are produced no analysable data at all.
router.use(profileRouter);
// GET /nudges — what is genuinely unfinished for this founder right now. See
// lib/nudges.ts for why nudges are derived per request and never stored.
router.use(nudgesRouter);
// GET /access/me + the operator half of the waitlist. Signup is OPEN unless
// VERA_SIGNUP_MODE=waitlist, in which case new accounts are captured and told
// where they stand rather than silently blocked. See routes/access.ts.
router.use(accessRouter);
// GET /billing/plans, /billing/status, POST /billing/checkout. The webhook
// half of billing.ts is NOT here — it is mounted directly in app.ts ahead of
// the JSON parser and CSRF check, since Stripe calls it server-to-server. See
// the comment there for why.
router.use(billingRouter);

export default router;
