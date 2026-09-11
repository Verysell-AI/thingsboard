#!/usr/bin/env bash
# Dumps the platform database and the IoT core's database and log volumes into one tarball.
# Usage: deploy/backup.sh [output.tar.gz]   (run from platform/, needs .env)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
OUT=${1:-backups/platform-$(date +%Y%m%d-%H%M%S).tar.gz}
PROJECT=$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$OUT")"

echo "• platform database"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-platform}" --format=custom > "$TMP/platform.dump"

echo "• IoT core volumes (core and its database paused for a consistent copy)"
docker compose stop thingsboard tb-db >/dev/null
for vol in tb-db-data tb-logs; do
  docker run --rm -v "${PROJECT}_${vol}:/data:ro" -v "$TMP:/out" alpine:3 tar czf "/out/${vol}.tgz" -C /data .
done
docker compose start tb-db thingsboard >/dev/null

cp .env.example "$TMP/env.example"
printf 'created=%s\nproject=%s\n' "$(date -u +%FT%TZ)" "$PROJECT" > "$TMP/manifest.txt"
tar czf "$OUT" -C "$TMP" .
echo "backup written to $OUT ($(du -h "$OUT" | cut -f1))"
