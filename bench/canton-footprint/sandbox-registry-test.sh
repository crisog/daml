#!/usr/bin/env bash
# Moves Canton Coin on a loaded sandbox through the token standard's HTTP
# registry API, with no Daml Script and no Splice app. It starts
# coin-sandbox/registry-service.py against the participant of the DSO party,
# and coin-sandbox/registry-client.py then moves Canton Coin from the first
# wallet of the first participant to the first wallet of the second
# participant. Run it as the AFTER_LOAD command of sandbox-load.sh:
#   AFTER_LOAD="$PWD/sandbox-registry-test.sh 5" ./sandbox-load.sh <label> default contracts 100
# It prints the row of registry-client.py and the requests that the registry
# served, and it ends with 0 only when the client ends with 0.
#
# Usage: sandbox-registry-test.sh <transfers>
# Environment: SANDBOX_ADDRESS, DSO and RUN_DIR, from sandbox-load.sh, and
#   HARNESS_DIR, the coin-sandbox project.
set -uo pipefail

readonly REGISTRY_PORT=18671
readonly REGISTRY_DEADLINE_S=20
readonly FIRST_HTTP_PORT=6864
readonly SECOND_HTTP_PORT=7864

transfers=${1:?transfers}
: "${SANDBOX_ADDRESS:?}" "${DSO:?}" "${RUN_DIR:?}" "${HARNESS_DIR:?}"
sender=$(head -1 "$RUN_DIR/wallets-one.txt")
receiver=$(head -1 "$RUN_DIR/wallets-two.txt")
first_ledger="http://$SANDBOX_ADDRESS:$FIRST_HTTP_PORT"
second_ledger="http://$SANDBOX_ADDRESS:$SECOND_HTTP_PORT"
registry="http://127.0.0.1:$REGISTRY_PORT"

python3 "$HARNESS_DIR/registry-service.py" "$first_ledger" "$DSO" "$REGISTRY_PORT" 2>"$RUN_DIR/registry-service.log" &
service_pid=$!
trap 'kill "$service_pid" 2>/dev/null' EXIT
# The service answers 404 for an unknown path when it is up.
deadline=$((SECONDS + REGISTRY_DEADLINE_S))
until [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "$registry/up")" == 404 ]]; do
  ((SECONDS < deadline)) || { echo "the registry service did not start"; exit 1; }
  sleep 0.2
done

python3 "$HARNESS_DIR/registry-client.py" "$registry" "$first_ledger" "$second_ledger" \
  "$DSO" "$sender" "$receiver" "$transfers"
code=$?
echo "registry requests: $(grep --count 'POST /registry/' "$RUN_DIR/registry-service.log")"
exit "$code"
