#!/bin/sh
# Decides whether the IoT core schema still has to be installed into its database.
# Runs once per `docker compose up` in the TimescaleDB image (has psql), before tb-install.
# Leaves /state/install-needed behind when the sysadmin user is absent; removes it otherwise.
set -eu
if psql -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM tb_user WHERE authority = 'SYS_ADMIN'" 2>/dev/null | grep -qx '[1-9][0-9]*'; then
  rm -f /state/install-needed
  echo "IoT core schema present in ${PGDATABASE}; no install needed"
else
  touch /state/install-needed
  echo "IoT core schema missing in ${PGDATABASE}; install scheduled"
fi
