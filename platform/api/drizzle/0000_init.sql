-- Database roles. Passwords are set by the deployment (compose init script or ALTER ROLE), never here.
-- "app" is the runtime role, subject to row-level security; "app_admin" bypasses RLS for migrations,
-- provisioning and background jobs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN BYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR', 'FINANCE', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('SITE', 'BUILDING', 'FLOOR', 'ROOM', 'ZONE');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('ACTIVE', 'IN_STOCK', 'IN_REPAIR', 'RETIRED', 'MISSING');--> statement-breakpoint
CREATE TYPE "public"."booking_attendance" AS ENUM('FULL', 'LATE', 'GHOST');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('ACTIVE', 'RELEASED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."command_source" AS ENUM('USER', 'AUTOMATION', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."hold_scope" AS ENUM('ZONE', 'FLOOR', 'ROOM');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('USER', 'SYSTEM', 'AUTOMATION', 'ANONYMOUS');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"hostname" text NOT NULL,
	"tb_tenant_id" text,
	"brand" jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"tariff_per_kwh" numeric(10, 4) DEFAULT '0.44' NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"demo_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_key_unique" UNIQUE("key"),
	CONSTRAINT "tenants_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"display_name" text NOT NULL,
	"employee_id" uuid,
	"refresh_token_version" text DEFAULT '0' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"desk_room_id" uuid,
	"desk_code" text,
	"zone" text,
	"persona" text,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "location_type" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"tb_asset_id" text,
	"floor" integer,
	"zone" text,
	"kind" text,
	"capacity" integer,
	"critical" boolean DEFAULT false NOT NULL,
	"geometry" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"type" text NOT NULL,
	"brand" text,
	"model" text,
	"serial" text,
	"category" text,
	"location_id" uuid,
	"custodian_employee_id" uuid,
	"purchase_date" date,
	"purchase_cost" numeric(12, 2),
	"useful_life_years" integer,
	"warranty_end" date,
	"status" "asset_status" DEFAULT 'ACTIVE' NOT NULL,
	"tb_device_id" text,
	"device_type" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"misplaced_room_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"organiser_id" uuid,
	"title" text NOT NULL,
	"attendance" "booking_attendance" DEFAULT 'FULL' NOT NULL,
	"status" "booking_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"method" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "command_source" NOT NULL,
	"actor_user_id" uuid,
	"automation_run_id" uuid,
	"result" text DEFAULT 'SENT' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"read_at" timestamp with time zone,
	"acted_at" timestamp with time zone,
	"acted_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "maintenance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"cause" text,
	"status" "maintenance_status" DEFAULT 'OPEN' NOT NULL,
	"created_from_alarm_id" text,
	"notes" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_type" "hold_scope" NOT NULL,
	"scope_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_nightly_stats" (
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"date" date NOT NULL,
	"avg_night_power_w" numeric(12, 2) DEFAULT '0' NOT NULL,
	"hours_above_5w" numeric(6, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "device_nightly_stats_tenant_id_asset_id_date_pk" PRIMARY KEY("tenant_id","asset_id","date")
);
--> statement-breakpoint
ALTER TABLE "device_nightly_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "room_daily_stats" (
	"tenant_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"date" date NOT NULL,
	"occupied_minutes" integer DEFAULT 0 NOT NULL,
	"booked_minutes" integer DEFAULT 0 NOT NULL,
	"ghost_count" integer DEFAULT 0 NOT NULL,
	"kwh" numeric(12, 4) DEFAULT '0' NOT NULL,
	"wasted_kwh" numeric(12, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "room_daily_stats_tenant_id_room_id_date_pk" PRIMARY KEY("tenant_id","room_id","date")
);
--> statement-breakpoint
ALTER TABLE "room_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf_path" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_desk_room_id_locations_id_fk" FOREIGN KEY ("desk_room_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_employee_id_employees_id_fk" FOREIGN KEY ("custodian_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_misplaced_room_id_locations_id_fk" FOREIGN KEY ("misplaced_room_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_locations_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organiser_id_employees_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_automation_run_id_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_nightly_stats" ADD CONSTRAINT "device_nightly_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_nightly_stats" ADD CONSTRAINT "device_nightly_stats_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_daily_stats" ADD CONSTRAINT "room_daily_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_daily_stats" ADD CONSTRAINT "room_daily_stats_room_id_locations_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_code_idx" ON "employees" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_code_idx" ON "locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "locations_tb_asset_idx" ON "locations" USING btree ("tb_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tenant_code_idx" ON "assets" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "assets_tb_device_idx" ON "assets" USING btree ("tb_device_id");--> statement-breakpoint
CREATE INDEX "assets_location_idx" ON "assets" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "bookings_room_start_idx" ON "bookings" USING btree ("room_id","start");--> statement-breakpoint
CREATE UNIQUE INDEX "automations_tenant_key_idx" ON "automations" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "commands_asset_sent_idx" ON "commands" USING btree ("asset_id","sent_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_ts_idx" ON "audit_log" USING btree ("tenant_id","ts");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "employees_tenant_isolation" ON "employees" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "locations" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "assets_tenant_isolation" ON "assets" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "bookings_tenant_isolation" ON "bookings" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "automation_runs_tenant_isolation" ON "automation_runs" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "automations_tenant_isolation" ON "automations" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "commands_tenant_isolation" ON "commands" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance_tasks_tenant_isolation" ON "maintenance_tasks" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "holds_tenant_isolation" ON "holds" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "device_nightly_stats_tenant_isolation" ON "device_nightly_stats" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "room_daily_stats_tenant_isolation" ON "room_daily_stats" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "reports_tenant_isolation" ON "reports" AS PERMISSIVE FOR ALL TO "app" USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;--> statement-breakpoint
GRANT ALL ON SCHEMA public TO app_admin;--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;--> statement-breakpoint
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_admin;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_admin;
