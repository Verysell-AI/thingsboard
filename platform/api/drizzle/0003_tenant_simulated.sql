ALTER TABLE "tenants" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Tenants provisioned before this column existed are the demo tenants the simulator already drove.
UPDATE "tenants" SET "simulated" = true WHERE "demo_mode" = true;
