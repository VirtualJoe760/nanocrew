CREATE TABLE "store_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp,
	CONSTRAINT "store_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "store_invites" ADD CONSTRAINT "store_invites_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invites" ADD CONSTRAINT "store_invites_invited_by_creators_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_invites_store_idx" ON "store_invites" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_invites_email_idx" ON "store_invites" USING btree ("email");-- RLS (rule: every new table)
ALTER TABLE public.store_invites ENABLE ROW LEVEL SECURITY;
