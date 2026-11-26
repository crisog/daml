#!/usr/bin/env bash
# Two LocalNet settings, each on and off, in turns, each with the transfer
# test between two validators:
#   full-shipped  every profile and every container, shipped limits
#   slim-shipped  the sv and app-user profiles, only the postgres, canton and
#                 splice containers, shipped limits
#   full-small    every profile and every container, the limits of
#                 localnet-small-limits.yaml
#   slim-small    both changes
# No restart. After the runs it writes the stages of each start.
# Usage: slim-2x2.sh <repetitions>
# Run fresh-host.sh with the localnet phase first: it downloads the inputs.
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-2x2
readonly TRANSFERS=5
readonly HEADLESS="postgres canton splice"
readonly SMALL=$WORK/localnet-small-limits.yaml
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none
export WORKLOAD="python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR $TRANSFERS app-user sv"
mkdir -p "$OUT"

for ((repetition = 1; repetition <= repetitions; repetition++)); do
  "$WORK/localnet.sh" "full-shipped-r$repetition" capped sv app-provider app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  SERVICES=$HEADLESS "$WORK/localnet.sh" "slim-shipped-r$repetition" capped sv app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  OVERRIDE=$SMALL "$WORK/localnet.sh" "full-small-r$repetition" capped sv app-provider app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  SERVICES=$HEADLESS OVERRIDE=$SMALL "$WORK/localnet.sh" "slim-small-r$repetition" capped sv app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
done

for variant in full-shipped:3 slim-shipped:2 full-small:3 slim-small:2; do
  name=${variant%:*}
  VALIDATORS=${variant#*:} python3 "$WORK/localnet-stages.py" "$RESULTS_DIR/$name"-r*/compose.log \
    >"$OUT/stages-$name.tsv" 2>&1
done
echo "exit=0" >"$OUT/EXIT"
