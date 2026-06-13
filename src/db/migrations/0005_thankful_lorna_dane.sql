ALTER TABLE "catalogues" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "catalogues" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "catalogue_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE set null ON UPDATE no action;