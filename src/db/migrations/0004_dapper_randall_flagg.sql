CREATE TYPE "public"."revision_status" AS ENUM('building', 'ready', 'approved', 'failed');--> statement-breakpoint
CREATE TABLE "store_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"request_md" text NOT NULL,
	"screenshots" jsonb,
	"status" "revision_status" DEFAULT 'building' NOT NULL,
	"branch" text NOT NULL,
	"preview_url" text,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_revisions" ADD CONSTRAINT "store_revisions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_revisions_store_idx" ON "store_revisions" USING btree ("store_id","status");