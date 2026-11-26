#!/usr/bin/env bash
# LocalNet cold starts with fewer parts, in turns, each with the transfer test:
#   one-headless   the sv profile; only the postgres, canton and splice
#                  containers. The transfer is between two wallet users of the
#                  one validator.
#   two-headless   the sv and app-user profiles, the same three containers.
#                  The transfer is between the two validators.
#   full-headless  every profile, the same three containers
#   full           every profile and every container, as LocalNet ships
# No restart. After the runs it writes the stages of each start.
# Usage: slim-ab.sh <repetitions>
# Run fresh-host.sh with the localnet phase first: it downloads the inputs.
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-slim
readonly TRANSFERS=5
readonly HEADLESS="postgres canton splice"
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none
mkdir -p "$OUT"

# run_variant <label> <services> <sender> <receiver> <profile>...
run_variant() {
  local label=$1 services=$2 sender=$3 receiver=$4
  shift 4
  SERVICES=$services \
    WORKLOAD="python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR $TRANSFERS $sender $receiver" \
    "$WORK/localnet.sh" "$label" capped "$@" >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
}

for ((repetition = 1; repetition <= repetitions; repetition++)); do
  run_variant "one-headless-r$repetition" "$HEADLESS" sv sv sv
  run_variant "two-headless-r$repetition" "$HEADLESS" app-user sv sv app-user
  run_variant "full-headless-r$repetition" "$HEADLESS" app-user app-provider sv app-provider app-user
  run_variant "full-r$repetition" "" app-user app-provider sv app-provider app-user
done

for variant in one-headless:1 two-headless:2 full-headless:3 full:3; do
  name=${variant%:*}
  VALIDATORS=${variant#*:} python3 "$WORK/localnet-stages.py" "$RESULTS_DIR/$name"-r*/compose.log \
    >"$OUT/stages-$name.tsv" 2>&1
done
echo "exit=0" >"$OUT/EXIT"
