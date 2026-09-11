CREATE TABLE "room_hourly_stats" (
	"tenant_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hour" integer NOT NULL,
	"occupied_minutes" integer DEFAULT 0 NOT NULL,
	"booked_minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "room_hourly_stats_tenant_id_room_id_date_hour_pk" PRIMARY KEY("tenant_id","room_id","date","hour")
);
--> statement-breakpoint
ALTER TABLE "room_hourly_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "standby_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"acknowledged_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "standby_acknowledgements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "room_hourly_stats" ADD CONSTRAINT "room_hourly_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_hourly_stats" ADD CONSTRAINT "room_hourly_stats_room_id_locations_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standby_acknowledgements" ADD CONSTRAINT "standby_acknowledgements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standby_acknowledgements" ADD CONSTRAINT "standby_acknowledgements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standby_acknowledgements" ADD CONSTRAINT "standby_acknowledgements_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standby_ack_tenant_asset_idx" ON "standby_acknowledgements" USING btree ("tenant_id","asset_id");--> statement-breakpoint
CREATE POLICY "room_hourly_stats_tenant_isolation" ON "room_hourly_stats" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "standby_acknowledgements_tenant_isolation" ON "standby_acknowledgements" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);