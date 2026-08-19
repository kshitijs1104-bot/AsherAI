export * from "./events";
export * from "./reports";
export * from "./companies";
export * from "./signals";
export * from "./thoughts";
export * from "./settings";
export * from "./precedents";
export * from "./venus_decisions";
export * from "./chats";
export * from "./goals";
export * from "./company_facts";
export * from "./roadmaps";
export * from "./messages";
export * from "./chat_summaries";
export * from "./queue_items";
export * from "./connectors";
export * from "./workflows";
export * from "./monthly_recaps";
export * from "./attachments";
export * from "./response_feedback";
export * from "./business_profiles";
export * from "./company_dossiers";
// Operator-facing tables. Not user data — these back suspension, the security
// event trail, and the durable usage counter. dataDeletion.ts deliberately
// does NOT cascade user_status or audit_events: a deleted account must still
// leave a record that it was suspended and why, or the trail can be erased by
// the person it is about. usage_daily IS cascaded (it is ordinary usage data).
export * from "./user_status";
export * from "./audit_events";
export * from "./usage_daily";
// Signup waitlist. Not user data in the deletion sense — a row here records
// that somebody ASKED for access, and survives them never getting an account.
// It is keyed on email rather than a Clerk user id for exactly that reason.
export * from "./access_requests";
// Which Stripe customer/subscription a Vera account maps to. Stripe is the
// system of record for the actual billing history; this is deleted (not
// anonymised) on account deletion — see dataDeletion.ts.
export * from "./subscriptions";
// What Vera has already nudged each founder about. See the header in
// nudge_state.ts for why the nudges themselves are derived and only the
// "have they been told / did they say no" part is stored.
export * from "./nudge_state";