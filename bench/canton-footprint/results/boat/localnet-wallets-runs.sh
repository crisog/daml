#!/usr/bin/env bash
# LocalNet as shipped with more wallet users, in steps: once with the shipped
# limits and once with the limits of localnet-small-limits.yaml. No restart.
# The rows of each step are in localnet/<label>/workload.log.
# Usage: localnet-wallets-runs.sh <target>...
# Run fresh-host.sh with the localnet phase first: it downloads the inputs.
set -uo pipefail

(($# > 0)) || { echo "at least one target is required" >&2; exit 2; }
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-wallets
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none
# The transfer test runs after the last step, on the network with every wallet.
export WORKLOAD="python3 $WORK/localnet-wallets.py $LOCALNET_DIR $* && python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR 5"
mkdir -p "$OUT"

"$WORK/localnet.sh" wallets-shipped capped sv app-provider app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
OVERRIDE="$WORK/localnet-small-limits.yaml" "$WORK/localnet.sh" wallets-small capped sv app-provider app-user \
  >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
echo "exit=0" >"$OUT/EXIT"
