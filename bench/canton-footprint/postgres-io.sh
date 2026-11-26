#!/usr/bin/env bash
# Prints what LocalNet's Postgres wrote and synced to disk since its start, and
# how long it waited, from the view pg_stat_io. Start LocalNet with
# localnet-io-timing.yaml, or the times are 0.
# Usage: postgres-io.sh
set -euo pipefail

docker exec postgres sh -c 'psql --username "$POSTGRES_USER" --dbname postgres --command "
  select object, context,
         sum(writes) as writes, round(sum(write_time)) as write_ms,
         sum(fsyncs) as fsyncs, round(sum(fsync_time)) as fsync_ms
  from pg_stat_io
  group by object, context
  having sum(writes) > 0 or sum(fsyncs) > 0
  order by object, context" --command "
  select sum(xact_commit) as commits from pg_stat_database"'
