#!/usr/bin/env bash
# Builds the images and (re)starts the stack on a server. Run from anywhere; expects platform/.env in place
# (its COMPOSE_FILE adds deploy/docker-compose.prod.yml). Called over SSH by .github/workflows/deploy-platform.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || { echo ".env is missing in $(pwd)" >&2; exit 1; }

echo "• building images (one at a time: parallel builds exhaust small machines)"
for svc in api simulator web; do
  docker compose build "$svc"
done

echo "• starting"
docker compose up -d --remove-orphans

echo "• waiting for the API"
for i in $(seq 1 60); do
  if docker compose ps --format '{{.Service}} {{.Health}}' | grep -qx 'api healthy'; then
    echo "API healthy"
    break
  fi
  sleep 5
  if [ "$i" -eq 60 ]; then
    echo "API did not become healthy" >&2
    docker compose logs --tail=100 api >&2
    exit 1
  fi
done

docker image prune -f >/dev/null
docker compose ps
