#!/bin/sh
# Runs once when the platform Postgres volume is created. Creates the two application roles:
#   app        - runtime role, subject to row-level security
#   app_admin  - bypasses RLS; used for migrations, provisioning and cross-tenant jobs
set -eu

: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
: "${DB_ADMIN_PASSWORD:?DB_ADMIN_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN PASSWORD '${DB_APP_PASSWORD}';
  ELSE
    ALTER ROLE app WITH LOGIN PASSWORD '${DB_APP_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN BYPASSRLS PASSWORD '${DB_ADMIN_PASSWORD}';
  ELSE
    ALTER ROLE app_admin WITH LOGIN BYPASSRLS PASSWORD '${DB_ADMIN_PASSWORD}';
  END IF;
END
\$\$;

GRANT ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" TO app_admin;
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO app;
ALTER SCHEMA public OWNER TO app_admin;
GRANT USAGE, CREATE ON SCHEMA public TO app_admin;
GRANT USAGE ON SCHEMA public TO app;
-- Tables created later by app_admin (migrations) are readable/writable by app; RLS still applies.
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
SQL
