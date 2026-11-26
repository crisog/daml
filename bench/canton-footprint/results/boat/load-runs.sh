#!/usr/bin/env bash
# The sandbox with a growing ledger, on a boat.dev machine: Canton Coin
# holdings and wallets in steps, with different heap limits.
# Usage: load-runs.sh <case>...
#   case  trial, or <axis>-<heap>, such as contracts-512m or wallets-default.
#         See sandbox-load.sh for the axes and the heap.
# Needs ~/cc-harness (the coin-sandbox project after prepare.sh), and bench.sh,
# fresh-host.sh and sandbox-load.sh in ~/canton-bench.
set -uo pipefail

readonly WORK=$HOME/canton-bench
readonly HARNESS=$HOME/cc-harness
readonly IMAGE=eclipse-temurin:21-jdk
readonly CONTRACT_TARGETS=(1000 2000 5000 10000 20000 50000 100000)
readonly WALLET_TARGETS=(10 100 500 1000 2000 5000)
export CANTON_DIR="$WORK/canton-open-source-3.7.4" HARNESS_DIR=$HARNESS RESULTS_DIR=$HOME/load-results
export STEP_DEADLINE_S=1200
export PATH="$HOME/.dpm/bin:$PATH"
mkdir -p "$RESULTS_DIR"
cd "$WORK" || exit 1

if [[ ! -d "$CANTON_DIR" ]]; then
  REPETITIONS=0 ./fresh-host.sh 4 8g sandbox >"$RESULTS_DIR/setup.log" 2>&1
fi
if ! command -v dpm >/dev/null; then
  curl --fail --silent --show-error https://get.digitalasset.com/install/install.sh | sh >>"$RESULTS_DIR/setup.log" 2>&1
fi
dpm install 3.5.2 >>"$RESULTS_DIR/setup.log" 2>&1
(cd "$HARNESS" && dpm build >>"$RESULTS_DIR/setup.log" 2>&1)
docker pull --quiet "$IMAGE" >/dev/null

for case in "$@"; do
  axis=${case%%-*}
  heap=${case#*-}
  case "$axis" in
    trial)
      ./sandbox-load.sh trial-contracts-default default contracts 100 300 1000 >>"$RESULTS_DIR/trial.tsv"
      ./sandbox-load.sh trial-wallets-default default wallets 10 30 100 >>"$RESULTS_DIR/trial.tsv"
      ./sandbox-load.sh trial-contracts-512m 512m contracts 100 300 1000 >>"$RESULTS_DIR/trial.tsv"
      ;;
    contracts) ./sandbox-load.sh "$case" "$heap" contracts "${CONTRACT_TARGETS[@]}" >>"$RESULTS_DIR/load.tsv" ;;
    wallets) ./sandbox-load.sh "$case" "$heap" wallets "${WALLET_TARGETS[@]}" >>"$RESULTS_DIR/load.tsv" ;;
    *) echo "unknown case: $case" >&2 ;;
  esac
done
{ nproc; grep -m1 'model name' /proc/cpuinfo | cut -d: -f2; free -m | sed -n 2,3p; } >"$RESULTS_DIR/host.txt"
echo finished >"$RESULTS_DIR/EXIT-$1"
