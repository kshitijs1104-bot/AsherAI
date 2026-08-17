CREATE TABLE "user_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"user_id" text,
	"actor_id" text,
	"subject" text,
	"route" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"day" text NOT NULL,
	"spent" integer DEFAULT 0 NOT NULL,
	"cooldown_until" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "policy_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "storage_driver" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "ingest_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "ingest_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_status_user_id_idx" ON "user_status" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_user_id_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_subject_day_idx" ON "usage_daily" USING btree ("subject","day");--> statement-breakpoint
CREATE INDEX "chats_user_id_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user_id_idx" ON "goals" USING btree ("user_id");