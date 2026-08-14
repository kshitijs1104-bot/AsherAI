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

export default router;
