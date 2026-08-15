CREATE TABLE "loras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"krea_job_id" text NOT NULL,
	"style_id" text,
	"trigger_word" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" integer DEFAULT 1000 NOT NULL,
	"cost_cents" integer,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "loras" ADD CONSTRAINT "loras_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loras" ADD CONSTRAINT "loras_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;-- RLS (rule: every new table)
ALTER TABLE public.loras ENABLE ROW LEVEL SECURITY;
