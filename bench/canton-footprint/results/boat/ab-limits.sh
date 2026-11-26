#!/usr/bin/env bash
# Starts LocalNet in turns with the override file and with the shipped limits,
# on one machine, and records the lowest available memory and the most swap in
# use during each start. A start that compose ends early gets an "up-failed" row.
# Usage: ab-limits.sh <repetitions>
#
# Environment:
#   TRANSFERS  when set, each run also moves Canton Coin between two parties
#              this many times before the restart (localnet-transfer-test.py)
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-ab
readonly SAMPLE_S=5
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet"
if [[ -n "${TRANSFERS:-}" ]]; then
  export WORKLOAD="python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR $TRANSFERS"
fi
mkdir -p "$OUT"

# Prints epoch seconds, available MiB and swap in use MiB until it is killed.
sample_memory() {
  while true; do
    awk -v now="$(date +%s)" '
      $1 == "MemAvailable:" { available = int($2 / 1024) }
      $1 == "SwapTotal:" { total = $2 }
      $1 == "SwapFree:" { free = $2 }
      END { printf "%s\t%d\t%d\n", now, available, (total - free) / 1024 }' /proc/meminfo
    sleep "$SAMPLE_S"
  done
}

for ((repetition = 1; repetition <= repetitions; repetition++)); do
  for variant in small shipped; do
    label="$variant-r$repetition"
    sample_memory >"$OUT/$label.memory.tsv" &
    sampler=$!
    if [[ "$variant" == small ]]; then
      export OVERRIDE="$WORK/localnet-small-limits.yaml"
    else
      unset OVERRIDE
    fi
    "$WORK/localnet.sh" "$label" capped sv app-provider app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err" ||
      printf '%s\tcapped\t-\tTOTAL\tNA\tNA\tNA\tup-failed\t-\n' "$label" >>"$OUT/localnet.tsv"
    kill "$sampler"
    awk -F'\t' -v label="$label" '
      NR == 1 || $2 < low { low = $2 }
      $3 > swap { swap = $3 }
      END { printf "%s\tlowest_available_mib=%d\tmost_swap_mib=%d\n", label, low, swap }' "$OUT/$label.memory.tsv" >>"$OUT/memory-summary.tsv"
  done
done
echo "exit=0" >"$OUT/EXIT"
