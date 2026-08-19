CREATE TYPE "public"."beta_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."beta_signup_status" AS ENUM('approved', 'waitlisted', 'failed');--> statement-breakpoint
CREATE TABLE "beta_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"platform" "beta_platform" NOT NULL,
	"status" "beta_signup_status" DEFAULT 'waitlisted' NOT NULL,
	"error_msg" text,
	"invited_at" timestamp with time zone,
	"launch_emailed_at" timestamp with time zone,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "beta_signups_email_platform_idx" ON "beta_signups" USING btree ("email","platform");--> statement-breakpoint
CREATE INDEX "beta_signups_platform_status_idx" ON "beta_signups" USING btree ("platform","status");