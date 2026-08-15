import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { requireAuth, requireUserId } from "../middlewares/auth";
import { deleteAllUserData } from "../lib/dataDeletion";

const router = Router();

/* ---------------------------------------------------------------------------
   DELETE /account — the endpoint behind "delete your account and everything
   goes with it" in section 7 of the privacy policy.

   There was no such endpoint before. The policy is what made one necessary: a
   stated right to erasure with no mechanism is a promise resting entirely on
   somebody remembering to run SQL by hand, correctly, across fifteen tables
   and a directory of files, every time a request arrives.

   THE ORDER MATTERS AND IS NOT INTERCHANGEABLE. Application data is deleted
   first, and only then the Clerk account. Reversed, a failure between the two
   steps would leave data that no login can reach and no future request can
   name — the user is gone, so nothing can identify their rows to delete them,
   and every one of their files stays on disk permanently. In this order, the
   same failure leaves a working account with its data already removed, which
   is recoverable: they can call it again.

   Deleting the Clerk user is what actually ends the account, and it is
   irreversible. Everything below is scoped to the caller's own verified user
   id — there is no path here to delete anyone else, by design: no id
   parameter, no admin branch, nothing to get wrong.
--------------------------------------------------------------------------- */

router.delete("/account", requireAuth, async (req, res) => {
  const userId = requireUserId(req);

  try {
    const report = await deleteAllUserData(userId);

    // Belt and braces on the destructive call: if Clerk deletion fails, the
    // data is already gone and the user still has a login, so they are told
    // plainly that the account itself survived rather than being shown a
    // success message for something that half happened.
    try {
      await clerkClient.users.deleteUser(userId);
    } catch (err) {
      req.log.error({ err, userId }, "Deleted all user data but failed to delete the Clerk account");
      return res.status(500).json({
        error:
          "Your data was deleted, but the account itself could not be closed. Please contact support so we can finish it.",
        dataDeleted: true,
        accountClosed: false,
        removed: report,
      });
    }

    req.log.info({ userId, report }, "Account deleted at the user's request");
    return res.json({ dataDeleted: true, accountClosed: true, removed: report });
  } catch (err) {
    req.log.error({ err, userId }, "Account deletion failed");
    return res.status(500).json({
      error: "Deletion did not complete. Nothing has been partially confirmed — please try again.",
      dataDeleted: false,
      accountClosed: false,
    });
  }
});

export default router;
