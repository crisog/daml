#!/usr/bin/env bash
# LocalNet cold starts with the shipped health probes and with a probe every
# 5 s (localnet-fast-probe.yaml), in turns. No restart.
# Usage: probe-ab.sh <repetitions>
# Run fresh-host.sh with the localnet phase first: it downloads the inputs.
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-probe
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none
mkdir -p "$OUT"

for ((repetition = 1; repetition <= repetitions; repetition++)); do
  "$WORK/localnet.sh" "shipped-r$repetition" capped sv app-provider app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  OVERRIDE="$WORK/localnet-fast-probe.yaml" "$WORK/localnet.sh" "probe-r$repetition" capped sv app-provider app-user \
    >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
done
echo "exit=0" >"$OUT/EXIT"
