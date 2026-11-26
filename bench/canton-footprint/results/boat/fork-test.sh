#!/usr/bin/env bash
# Runs on a machine with a healthy LocalNet, or on a boat.dev fork of that
# machine. It reports the state that a fork must keep: the containers, the
# time of the first answer of the wallet API, the balance of the app-user
# wallet, and a transfer of Canton Coin.
# One row: label, containers_running, splice_started_at, machine_uptime_s,
#   first_answer_ms, balance_before, balance_after, transfer state.
# "first_answer_ms" counts from the start of this script. The balance after
# the test on the source must be the balance before the test on its fork.
# Usage: fork-test.sh <label>
set -uo pipefail

label=${1:?label}
readonly WORK=$HOME/canton-bench
readonly LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
readonly ANSWER_DEADLINE_S=600
readonly WALLET_READY_URL=http://127.0.0.1:2903/api/validator/readyz
readonly TRANSFERS=2
cd "$WORK" || exit 1

balance() {
  python3 -c 'import pathlib, sys
from localnet_wallet import wallet
print(wallet(pathlib.Path(sys.argv[1]), "app-user").balance())' "$LOCALNET_DIR" 2>/dev/null || echo NA
}

started_ns=$(date +%s%N)
uptime_s=$(cut -d' ' -f1 /proc/uptime)
deadline=$((SECONDS + ANSWER_DEADLINE_S))
first_answer_ms=NA
while ((SECONDS < deadline)); do
  if curl --silent --fail --max-time 5 --output /dev/null "$WALLET_READY_URL"; then
    first_answer_ms=$((($(date +%s%N) - started_ns) / 1000000))
    break
  fi
  sleep 0.5
done
running=$(docker ps --quiet | wc -l)
splice_started=$(docker inspect --format '{{.State.StartedAt}}' splice 2>/dev/null || echo NA)
balance_before=$(balance)
transfer=failed
python3 "$WORK/localnet-transfer-test.py" "$LOCALNET_DIR" "$TRANSFERS" >"$WORK/fork-test-$label.log" 2>&1 && transfer=passed
balance_after=$(balance)
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$running" "$splice_started" "$uptime_s" \
  "$first_answer_ms" "$balance_before" "$balance_after" "$transfer"
