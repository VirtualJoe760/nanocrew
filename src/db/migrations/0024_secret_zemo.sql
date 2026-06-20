CREATE TYPE "public"."payout_status" AS ENUM('none', 'held', 'released', 'reversed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."return_reason" AS ENUM('defective', 'wrong_item', 'damaged', 'not_received');--> statement-breakpoint
CREATE TYPE "public"."return_request_status" AS ENUM('requested', 'approved', 'declined', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'return_requested';--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_email" text NOT NULL,
	"reason" "return_reason" NOT NULL,
	"items_json" jsonb,
	"photo_urls" jsonb,
	"note" text,
	"status" "return_request_status" DEFAULT 'requested' NOT NULL,
	"resolution" text,
	"refund_id" text,
	"rma_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_window_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "brand_net_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "connected_account_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payout_status" "payout_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payout_release_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payout_transfer_id" text;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "return_requests_store_idx" ON "return_requests" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "return_requests_status_idx" ON "return_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_payout_release_idx" ON "orders" USING btree ("payout_status","payout_release_at");--> statement-breakpoint
-- RLS lockdown (supabase-rls rule): new tables come back RLS-off and re-open the anon-key hole.
-- No policies = deny-all for anon/authenticated; the app/platform-api connect as the table owner
-- (rolbypassrls) so real code paths are unaffected. See the supabase-rls memory + DATABASE_PLAN.md.
ALTER TABLE "return_requests" ENABLE ROW LEVEL SECURITY;