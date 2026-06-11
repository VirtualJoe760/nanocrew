CREATE TYPE "public"."composition_status" AS ENUM('generating', 'draft', 'approved', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'paid', 'submitted_to_printful', 'in_production', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('draft', 'building', 'live', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "canvas_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"group_id" text,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"scale" integer DEFAULT 100 NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"color_image" text,
	"selected_color" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"placement" text DEFAULT 'front' NOT NULL,
	"position" jsonb,
	"placements" jsonb,
	"preview_url" text,
	"status" "composition_status" DEFAULT 'generating' NOT NULL,
	"printful_sync_product_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_creator_id_unique" UNIQUE("creator_id"),
	CONSTRAINT "connected_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"cloudinary_public_id" text,
	"url" text NOT NULL,
	"thumb_url" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"name_snapshot" text NOT NULL,
	"variant_snapshot" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_email" text NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"printful_order_id" text,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"shipping_address_json" jsonb,
	"tracking_url" text,
	"tracking_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"printful_sync_product_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description_md" text,
	"category" text,
	"image_url" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_printful_sync_product_id_unique" UNIQUE("printful_sync_product_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"status" "store_status" DEFAULT 'draft' NOT NULL,
	"brand_profile" jsonb,
	"design_system" jsonb,
	"logo_url" text,
	"favicon_url" text,
	"og_image_url" text,
	"tagline" text,
	"description_md" text,
	"printful_store_id" text,
	"deployment_url" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" "subscription_plan" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"printful_sync_variant_id" text,
	"sku" text NOT NULL,
	"color" text,
	"size" text,
	"retail_price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"image_url" text,
	CONSTRAINT "variants_printful_sync_variant_id_unique" UNIQUE("printful_sync_variant_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogues" ADD CONSTRAINT "catalogues_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designs" ADD CONSTRAINT "designs_created_by_creators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_nodes_catalogue_idx" ON "canvas_nodes" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "catalogues_store_idx" ON "catalogues" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalogues_store_slug_idx" ON "catalogues" USING btree ("store_id","slug");--> statement-breakpoint
CREATE INDEX "compositions_catalogue_idx" ON "compositions" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "designs_catalogue_idx" ON "designs" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "orders_store_idx" ON "orders" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_store_idx" ON "products" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_slug_idx" ON "products" USING btree ("store_id","slug");--> statement-breakpoint
CREATE INDEX "products_published_idx" ON "products" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "stores_creator_idx" ON "stores" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "stores_public_idx" ON "stores" USING btree ("is_public","status");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_idx" ON "variants" USING btree ("sku");