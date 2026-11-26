#!/usr/bin/env bash
# What LocalNet's Postgres container holds, on a boat.dev machine: one LocalNet
# as shipped with a sample of the container's memory every 5 seconds from
# before the start, 20 transfers of Canton Coin, a report, 5 idle minutes, and
# a second report. The network stays up at the end.
# Usage: postgres-memory-run.sh <label> [max-connections]
#   max-connections  the size of the database connection pool of each Canton
#                    node and each Splice app. The release sets 32 in
#                    conf/canton/app.conf and conf/splice/app.conf. When given,
#                    the script writes this value to both files before the start.
# Environment:
#   WAIT_FOR  a file to wait for before the run (optional)
#   IDLE_S    seconds between the two reports (default 300). With 0, the
#             script writes one report.
# Needs fresh-host.sh, bench.sh, localnet.sh, localnet-transfer-test.py,
# localnet_wallet.py and postgres-memory.sh in ~/canton-bench.
# Results: ~/canton-bench/pg-<label>/ (report.txt, samples.tsv, localnet.tsv, pool.txt).
set -uo pipefail

label=${1:?label}
pool=${2:-}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/pg-$label
readonly PROJECT=canton-bench-localnet
readonly SAMPLE_S=900
readonly IDLE_S=${IDLE_S:-300}
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
mkdir -p "$OUT"
cd "$WORK" || exit 1

if [[ -n "${WAIT_FOR:-}" ]]; then
  until [[ -f "$WAIT_FOR" ]]; do sleep 10; done
fi
docker compose --project-name "$PROJECT" down --volumes >/dev/null 2>&1
if [[ ! -d "$LOCALNET_DIR" ]]; then
  REPETITIONS=0 ./fresh-host.sh 4 8g localnet >"$OUT/setup.log" 2>&1
fi
readonly POOL_FILES=("$LOCALNET_DIR/conf/canton/app.conf" "$LOCALNET_DIR/conf/splice/app.conf")
if [[ -n "$pool" ]]; then
  sed --in-place --regexp-extended "s/(max-connections = )[0-9]+/\1$pool/" "${POOL_FILES[@]}"
fi
grep --with-filename 'max-connections' "${POOL_FILES[@]}" | sed "s|$LOCALNET_DIR/||" >"$OUT/pool.txt"

./postgres-memory.sh sample "$SAMPLE_S" 5 >"$OUT/samples.tsv" 2>/dev/null &
sampler=$!

export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none KEEP=1
export WORKLOAD="python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR 20"
./localnet.sh "pg-$label" capped sv app-provider app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"

./postgres-memory.sh report after-test >"$OUT/report.txt" 2>&1
if ((IDLE_S > 0)); then
  sleep "$IDLE_S"
  ./postgres-memory.sh report "idle-$IDLE_S-seconds" >>"$OUT/report.txt" 2>&1
fi
# A sampler that outlives the run reads the Postgres container of the next run.
kill "$sampler" 2>/dev/null
echo finished >"$OUT/EXIT"
