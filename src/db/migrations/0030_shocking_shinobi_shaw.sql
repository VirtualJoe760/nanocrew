ALTER TABLE "loras" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "loras" ADD COLUMN "creator_id" uuid;--> statement-breakpoint
ALTER TABLE "loras" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "loras" ADD COLUMN "photo_urls" jsonb;--> statement-breakpoint
ALTER TABLE "loras" ADD CONSTRAINT "loras_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;