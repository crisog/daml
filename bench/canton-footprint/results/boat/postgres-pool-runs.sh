#!/usr/bin/env bash
# LocalNet with the connection pool of the release (32) and with a pool of 8,
# in turns, on a boat.dev machine. Each run is one postgres-memory-run.sh with
# one report.
# Usage: postgres-pool-runs.sh <first-repetition> <last-repetition>
set -uo pipefail

first=${1:?first repetition}
last=${2:?last repetition}
cd "$HOME/canton-bench" || exit 1
export IDLE_S=0
for ((repetition = first; repetition <= last; repetition++)); do
  ./postgres-memory-run.sh "pool32-r$repetition" 32 >"pg-run-pool32-r$repetition.log" 2>&1
  ./postgres-memory-run.sh "pool8-r$repetition" 8 >"pg-run-pool8-r$repetition.log" 2>&1
done
echo finished >"$HOME/canton-bench/pg-pool-runs.EXIT"
