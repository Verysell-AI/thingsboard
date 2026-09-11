#!/bin/bash
# Installs the IoT core schema and system data on the first start of a fresh database.
# Runs once per `docker compose up` in the ThingsBoard image; tb-db-probe decides whether it has work.
set -euo pipefail
if [ ! -f /state/install-needed ]; then
  echo "IoT core schema already installed; nothing to do"
  exit 0
fi
echo "Installing the IoT core schema into ${SPRING_DATASOURCE_URL} (timeseries: ${DATABASE_TS_TYPE}) ..."
export INSTALL_TB=true LOAD_DEMO=false
exec start-tb-node.sh
