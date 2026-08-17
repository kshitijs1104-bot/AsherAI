CREATE TABLE "chat_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"topics" text DEFAULT '' NOT NULL,
	"last_message_id" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'model' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "chat_summaries_user_id_idx" ON "chat_summaries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_summaries_chat_id_key" ON "chat_summaries" USING btree ("chat_id");