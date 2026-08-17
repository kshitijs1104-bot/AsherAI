-- BASELINE MIGRATION. Read this before running it anywhere.
--
-- This file records the schema as it already existed in production on
-- 2026-08-16, at the point migrations were adopted. Until then the only
-- schema mechanism was `drizzle-kit push`, which applies a diff straight to
-- the live database and writes no SQL down — so there was no migration
-- history, nothing was reviewed before it ran, and a renamed column was
-- silently a DROP plus a CREATE.
--
-- EVERY STATEMENT HERE IS IDEMPOTENT, and that is deliberate rather than
-- tidiness. The database this first runs against ALREADY HAS these 22 tables.
-- Generated as plain CREATE TABLE it would abort on the first one, which is
-- the trap that makes people give up on migrations and go back to push. With
-- IF NOT EXISTS it is a no-op against the existing database and a full
-- creation against a fresh one, so the same command works for both.
--
-- It contains NO DROP of any kind. Applying it cannot lose data.
--
-- The real change that came with adopting migrations is 0001, which is
-- additive only. Everything after this point is ordinary generated SQL:
-- generate it, READ IT, commit it, then migrate.

CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"sentiment" text NOT NULL,
	"impact" integer DEFAULT 50 NOT NULL,
	"source" text NOT NULL,
	"ripple_count" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"published_at" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"image_url" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"year_range" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"value" text,
	"change" text NOT NULL,
	"sentiment" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"thought_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"reaction_type" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "reactions_unique" UNIQUE("thought_id","session_id","reaction_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thoughts" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"author" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"tier" text DEFAULT 'personal' NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"company_name" text,
	"stage" text,
	"industry" text,
	"team_size" text,
	"country" text,
	"primary_goal" text,
	"venus_business_context" text,
	"venus_business_context_updated_at" timestamp,
	"active_profile_id" integer,
	"pending_new_profile_intake" boolean DEFAULT false NOT NULL,
	"pending_context_confirmation" boolean DEFAULT false NOT NULL,
	"pending_preference_text" text,
	"pending_fact_contradiction" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "settings_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "precedents" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"sector" text NOT NULL,
	"founded_year" integer,
	"outcome_year" integer,
	"status" text NOT NULL,
	"stage_at_decision" text NOT NULL,
	"decision_context" text NOT NULL,
	"decision_taken" text NOT NULL,
	"causal_mechanism" text NOT NULL,
	"outcome" text NOT NULL,
	"timeframe_to_outcome" text,
	"source_citation" text NOT NULL,
	"verification_status" text DEFAULT 'auto-extracted-unverified' NOT NULL,
	"embedding_summary" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venus_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" integer,
	"query" text NOT NULL,
	"business_context_snapshot" text,
	"card_type" text NOT NULL,
	"recommendation_summary" text NOT NULL,
	"card_content_json" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"lesson" text,
	"outcome_sentiment" text,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"decision_type" text,
	"archived" boolean DEFAULT false NOT NULL,
	"reinforced_count" integer DEFAULT 1 NOT NULL,
	"roadmap_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"success_metric" text NOT NULL,
	"value_inr" integer NOT NULL,
	"deadline" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence_score" real DEFAULT 0 NOT NULL,
	"evidence_log" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	CONSTRAINT "goals_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" integer,
	"fact_text" text NOT NULL,
	"fact_type" text DEFAULT 'general' NOT NULL,
	"entry_kind" text DEFAULT 'business_fact' NOT NULL,
	"claim_type" text DEFAULT 'user_reported_belief' NOT NULL,
	"source_type" text NOT NULL,
	"confidence" real,
	"superseded_by" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roadmaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"horizon" text,
	"phases_json" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_decision_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" integer,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queue_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"draft_content" text,
	"external_id" text,
	"metadata_json" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"oauth_token_ref" text,
	"last_synced_at" timestamp,
	"config_json" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connector_types_json" text DEFAULT '[]' NOT NULL,
	"schedule_cron" text NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_recaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period_month" text NOT NULL,
	"data_json" text NOT NULL,
	"generated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" integer,
	"message_id" integer,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "response_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" integer,
	"original_query" text,
	"original_response" text,
	"correction_text" text NOT NULL,
	"detected_issue" text,
	"issue_class" text,
	"consumed_by_eval" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"context_blob" text,
	"context_updated_at" timestamp,
	"last_active_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_dossiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" integer,
	"source_text" text NOT NULL,
	"source_label" text,
	"extracted_json" text NOT NULL,
	"questions_json" text NOT NULL,
	"answers_json" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reactions" ADD CONSTRAINT "reactions_thought_id_thoughts_id_fk" FOREIGN KEY ("thought_id") REFERENCES "public"."thoughts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venus_decisions_session_status_idx" ON "venus_decisions" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venus_decisions_chat_id_idx" ON "venus_decisions" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_facts_user_id_idx" ON "company_facts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmaps_chat_id_idx" ON "roadmaps" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmaps_user_id_idx" ON "roadmaps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_chat_id_idx" ON "messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queue_items_user_status_idx" ON "queue_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "queue_items_dedupe_idx" ON "queue_items" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connectors_user_type_idx" ON "connectors" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_user_status_idx" ON "workflows" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_recaps_user_period_idx" ON "monthly_recaps" USING btree ("user_id","period_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_user_id_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_chat_id_idx" ON "attachments" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "response_feedback_user_id_idx" ON "response_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "response_feedback_consumed_idx" ON "response_feedback" USING btree ("consumed_by_eval");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_profiles_user_id_idx" ON "business_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_dossiers_user_id_idx" ON "company_dossiers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_dossiers_user_profile_idx" ON "company_dossiers" USING btree ("user_id","profile_id");