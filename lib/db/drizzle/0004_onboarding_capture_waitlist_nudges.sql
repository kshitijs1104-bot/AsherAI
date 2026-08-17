CREATE TABLE "access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nudge_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"last_shown_at" timestamp,
	"shown_count" integer DEFAULT 0 NOT NULL,
	"dismissed_at" timestamp,
	"satisfied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "monthly_revenue" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "referral_source" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_email_idx" ON "access_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "access_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "nudge_state_user_kind_idx" ON "nudge_state" USING btree ("user_id","kind");