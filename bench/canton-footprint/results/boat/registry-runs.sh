#!/usr/bin/env bash
# Canton Coin through the token standard's HTTP registry API on a sandbox, with
# no Splice app and no Daml Script for the transfers, on a boat.dev machine.
# Each run starts the three-participant sandbox, creates the registry and 10
# wallets with 10 holdings each, and then runs sandbox-registry-test.sh.
# Usage: registry-runs.sh <runs> <transfers>
# Needs ~/cc-harness (the coin-sandbox project after prepare.sh), and bench.sh,
# fresh-host.sh, sandbox-load.sh and sandbox-registry-test.sh in ~/canton-bench.
set -uo pipefail

runs=${1:?runs}
transfers=${2:?transfers}
readonly WORK=$HOME/canton-bench
readonly HARNESS=$HOME/cc-harness
readonly IMAGE=eclipse-temurin:21-jdk
export CANTON_DIR="$WORK/canton-open-source-3.7.4" HARNESS_DIR=$HARNESS RESULTS_DIR=$HOME/registry-results
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

for ((run = 1; run <= runs; run++)); do
  AFTER_LOAD="$WORK/sandbox-registry-test.sh $transfers" \
    ./sandbox-load.sh "registry-r$run" default contracts 100 >>"$RESULTS_DIR/registry.tsv"
done
echo finished >"$RESULTS_DIR/EXIT"
