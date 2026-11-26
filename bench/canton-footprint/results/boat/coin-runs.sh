#!/usr/bin/env bash
# Canton Coin with no Splice app, on a boat.dev machine:
#   1. Splice's own transfer tests with `dpm test` (no network), three times
#   2. sandbox-coin.sh, three times with each sandbox layout, in turns
#   3. sandbox-coin.sh with a copy of the script that has no accept step. This
#      run must end with "script-failed".
# It waits for a file first when WAIT_FOR is set, so that it does not run next
# to another measurement on the same machine.
# Usage: coin-runs.sh
# Needs ~/cc-harness (the coin-sandbox project after prepare.sh), bench.sh,
# fresh-host.sh and sandbox-coin.sh in ~/canton-bench.
set -uo pipefail

readonly WORK=$HOME/canton-bench
readonly HARNESS=$HOME/cc-harness
readonly IMAGE=eclipse-temurin:21-jdk
export CANTON_DIR="$WORK/canton-open-source-3.7.4" RESULTS_DIR=$HOME/coin-final
export PATH="$HOME/.dpm/bin:$PATH"
mkdir -p "$RESULTS_DIR"
cd "$WORK" || exit 1

if [[ -n "${WAIT_FOR:-}" ]]; then
  until [[ -f "$WAIT_FOR" ]]; do sleep 10; done
fi

REPETITIONS=0 ./fresh-host.sh 4 8g sandbox >"$RESULTS_DIR/setup.log" 2>&1
if ! command -v dpm >/dev/null; then
  curl --fail --silent --show-error https://get.digitalasset.com/install/install.sh | sh >>"$RESULTS_DIR/setup.log" 2>&1
fi
dpm install 3.5.2 >>"$RESULTS_DIR/setup.log" 2>&1
(cd "$HARNESS" && dpm build >>"$RESULTS_DIR/setup.log" 2>&1)
docker pull --quiet "$IMAGE" >/dev/null

# The SDK needs a newer Java than the machine has, so dpm runs in the Java image.
for run in 1 2 3; do
  started_ns=$(date +%s%N)
  docker run --rm --user "$(id -u):$(id -g)" --env HOME="$HOME" \
    --env PATH="$HOME/.dpm/bin:/opt/java/openjdk/bin:/usr/bin:/bin" \
    --volume "$HOME:$HOME" --workdir "$HARNESS" "$IMAGE" dpm test >"$RESULTS_DIR/dpm-test-r$run.log" 2>&1
  code=$?
  printf 'dpm-test-r%s\t%s\texit=%s\tok=%s\n' "$run" "$((($(date +%s%N) - started_ns) / 1000000))" "$code" \
    "$(grep --count ': ok' "$RESULTS_DIR/dpm-test-r$run.log")" >>"$RESULTS_DIR/dpm-test.tsv"
done

for run in 1 2 3; do
  HARNESS_DIR=$HARNESS TOPOLOGY=multi-sync ./sandbox-coin.sh "multi-sync-r$run" 5 >>"$RESULTS_DIR/coin.tsv"
  HARNESS_DIR=$HARNESS TOPOLOGY=two ./sandbox-coin.sh "two-r$run" 5 >>"$RESULTS_DIR/coin.tsv"
done

readonly RED=$HOME/cc-harness-no-accept
mkdir -p "$RED"
cp -r "$HARNESS/daml" "$HARNESS/daml.yaml" "$HARNESS/dars" "$RED/"
python3 - "$RED/daml/SandboxTransfer.daml" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
start = text.index("    context <- RegistryApi.getTransferInstruction_AcceptContext")
end = text.index('    debug ("transfer "')
path.write_text(text[:start] + text[end:])
PY
(cd "$RED" && dpm build >"$RESULTS_DIR/no-accept-build.log" 2>&1)
HARNESS_DIR=$RED TOPOLOGY=multi-sync ./sandbox-coin.sh no-accept 5 >>"$RESULTS_DIR/coin.tsv"

{ nproc; grep -m1 'model name' /proc/cpuinfo | cut -d: -f2; free -m | sed -n 2p; java -version 2>&1 | head -1; } >"$RESULTS_DIR/host.txt"
echo finished >"$RESULTS_DIR/EXIT"
