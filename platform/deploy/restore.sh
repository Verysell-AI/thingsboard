#!/usr/bin/env bash
# Restores a backup made by deploy/backup.sh: platform database, IoT core database and log volumes.
# Usage: deploy/restore.sh backups/platform-....tar.gz   (run from platform/, needs .env)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
FILE=${1:?usage: restore.sh <backup.tar.gz>}
PROJECT=$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar xzf "$FILE" -C "$TMP"
if [ ! -f "$TMP/tb-db-data.tgz" ]; then
  echo "this backup predates the external IoT core database (no tb-db-data.tgz); it cannot be restored into this stack" >&2
  exit 1
fi

echo "• stopping the services that write"
docker compose stop api worker simulator web thingsboard tb-db >/dev/null

echo "• platform database"
DB=${POSTGRES_DB:-platform}
PGUSER=${POSTGRES_USER:-postgres}
docker compose exec -T postgres psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$DB\";" \
  -c "CREATE DATABASE \"$DB\" OWNER \"$PGUSER\";" >/dev/null
# the same grants the compose init script gives a fresh database (deploy/postgres-init.sh)
docker compose exec -T postgres psql -U "$PGUSER" -d "$DB" -v ON_ERROR_STOP=1 <<SQL >/dev/null
GRANT ALL PRIVILEGES ON DATABASE "$DB" TO app_admin;
GRANT CONNECT ON DATABASE "$DB" TO app;
ALTER SCHEMA public OWNER TO app_admin;
GRANT USAGE, CREATE ON SCHEMA public TO app_admin;
GRANT USAGE ON SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
SQL
# owners come back as dumped (app_admin owns the tables, app_admin runs the migrations)
docker compose exec -T postgres pg_restore -U "$PGUSER" -d "$DB" --exit-on-error < "$TMP/platform.dump"

echo "• IoT core volumes"
for vol in tb-db-data tb-logs; do
  docker run --rm -v "${PROJECT}_${vol}:/data" -v "$TMP:/in:ro" alpine:3 sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /in/${vol}.tgz -C /data"
done

echo "• starting everything"
docker compose up -d >/dev/null
echo "restored from $FILE; live state rebuilds from the core on the first requests"
