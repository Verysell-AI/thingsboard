CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
-- Brand logos and favicons carry their media type so raster uploads work alongside SVG markup.
UPDATE "tenants" SET "brand" = ("brand" - 'logoSvg' - 'faviconSvg')
  || jsonb_build_object(
       'logo', jsonb_build_object('mime', 'image/svg+xml', 'content', "brand" ->> 'logoSvg'),
       'favicon', jsonb_build_object('mime', 'image/svg+xml', 'content', "brand" ->> 'faviconSvg')
     )
WHERE "brand" ? 'logoSvg';
