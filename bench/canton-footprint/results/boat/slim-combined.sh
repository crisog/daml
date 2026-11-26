#!/usr/bin/env bash
# The three LocalNet settings of the post together, against LocalNet as shipped,
# in turns, each with the transfer test between two validators:
#   full  every profile and every container, shipped limits
#   slim  the sv and app-user profiles, only the postgres, canton and splice
#         containers, and the limits of localnet-small-limits.yaml
# No restart. After the runs it writes the stages of each start.
# Usage: slim-combined.sh <repetitions>
# Run fresh-host.sh with the localnet phase first: it downloads the inputs.
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-combined
readonly TRANSFERS=5
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none
readonly TEST="python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR $TRANSFERS app-user sv"
mkdir -p "$OUT"

for ((repetition = 1; repetition <= repetitions; repetition++)); do
  WORKLOAD=$TEST "$WORK/localnet.sh" "full-r$repetition" capped sv app-provider app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  SERVICES="postgres canton splice" OVERRIDE="$WORK/localnet-small-limits.yaml" WORKLOAD=$TEST \
    "$WORK/localnet.sh" "slim-r$repetition" capped sv app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
done

VALIDATORS=3 python3 "$WORK/localnet-stages.py" "$RESULTS_DIR"/full-r*/compose.log >"$OUT/stages-full.tsv" 2>&1
VALIDATORS=2 python3 "$WORK/localnet-stages.py" "$RESULTS_DIR"/slim-r*/compose.log >"$OUT/stages-slim.tsv" 2>&1
{ nproc; grep -m1 'model name' /proc/cpuinfo | cut -d: -f2; free -m | sed -n 2,3p; } >"$OUT/host.txt"
echo "exit=0" >"$OUT/EXIT"
