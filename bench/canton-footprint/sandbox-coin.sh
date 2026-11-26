#!/usr/bin/env bash
# Moves Canton Coin between two participants of a Canton sandbox, with no
# Splice app. It starts the sandbox, uploads one DAR (Splice's Daml packages, a
# copy of Splice's Daml Script test code and SandboxTransfer.daml) to both
# participants, allocates three parties, and runs the script. The DSO party and
# the sender are on the first participant, and the receiver is on the second.
# It prints one tab-separated row: label, topology, transfers, sandbox_ready_ms,
# setup_ms, script_ms, memory_mib, peak_mib, state. Setup is the upload and the
# parties. The memory is that of the sandbox container after the script. State
# is "passed" when the script ended with 0: the script checks both balances.
#
# Usage: sandbox-coin.sh <label> <transfers>
#
# Environment:
#   TOPOLOGY     two (default)  two participants on one synchronizer
#                multi-sync     the sandbox with --multi-sync: the two
#                               participants are "sandbox" and "pebblebox"
#   CANTON_DIR   extracted canton-open-source release (required)
#   HARNESS_DIR  the built Daml project (required): its DAR is in .daml/dist
#   RESULTS_DIR  where logs are kept (required)
#   IMAGE        Java image (default eclipse-temurin:21-jdk)
# Requires docker, curl, jq, and dpm with the SDK of the project in ~/.dpm.
set -uo pipefail

readonly READY_DEADLINE_S=300
readonly KNOWN_DEADLINE_S=30
readonly READY_LINE='Canton sandbox is ready.'
readonly CONTAINER=canton-bench-coin
readonly SYNCHRONIZER_ALIAS=synchronizer-1
readonly FIRST_HTTP_PORT=6864
readonly FIRST_LEDGER_PORT=6865

label=${1:?label}
transfers=${2:?transfers}
: "${CANTON_DIR:?CANTON_DIR is required}"
: "${HARNESS_DIR:?HARNESS_DIR is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}
topology=${TOPOLOGY:-two}

run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"
dar=$(ls "$HARNESS_DIR"/.daml/dist/*.dar | head -1)

canton_args=(sandbox)
case "$topology" in
  two)
    second_http_port=10020
    second_ledger_port=10021
    cat >"$run_dir/topology.conf" <<CONF
canton.participants.sandbox.http-ledger-api.address = "0.0.0.0"
canton.participants.p2.http-ledger-api.address = "0.0.0.0"
canton.participants.p2.http-ledger-api.port = $second_http_port
canton.participants.p2.ledger-api.port = $second_ledger_port
canton.participants.p2.admin-api.port = $((second_ledger_port + 1))
canton.participants.p2.storage.type = memory
CONF
    ;;
  multi-sync)
    second_http_port=7864
    second_ledger_port=7865
    canton_args+=(--multi-sync)
    cat >"$run_dir/topology.conf" <<CONF
canton.participants.sandbox.http-ledger-api.address = "0.0.0.0"
canton.participants.pebblebox.http-ledger-api.address = "0.0.0.0"
CONF
    ;;
  *)
    echo "TOPOLOGY must be two or multi-sync" >&2
    exit 2
    ;;
esac

cleanup() {
  docker logs --timestamps "$CONTAINER" >"$run_dir/container.log" 2>&1 || true
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm --force "$CONTAINER" >/dev/null 2>&1 || true

started_ns=$(date +%s%N)
docker run --detach --name "$CONTAINER" --cpus 4 --memory 8g \
  --volume "$CANTON_DIR:/canton:ro" --volume "$run_dir:/work" --workdir /work \
  "$IMAGE" /canton/bin/canton "${canton_args[@]}" -c /work/topology.conf >/dev/null
if ! timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
  <(docker logs --follow "$CONTAINER" 2>&1); then
  printf '%s\t%s\t%s\tNA\tNA\tNA\tNA\tNA\tsandbox-not-ready\n' "$label" "$topology" "$transfers"
  exit 0
fi
ready_ms=$((($(date +%s%N) - started_ns) / 1000000))

address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")
api() { # api <http-port> <path> [curl options]
  local port=$1 path=$2
  shift 2
  curl --silent --show-error --fail --max-time 120 "$@" "http://$address:$port$path"
}
# A participant with two synchronizers needs the synchronizer in each request.
allocate_party() { # allocate_party <http-port> <hint>
  jq --null-input --arg hint "$2" --arg synchronizer "$synchronizer" \
    '{partyIdHint: $hint, identityProviderId: "", synchronizerId: $synchronizer}' |
    api "$1" /v2/parties --request POST --header 'Content-Type: application/json' --data @- |
    jq --raw-output --exit-status '.partyDetails.party'
}
# A party reaches the other participant through the synchronizer.
wait_until_known() { # wait_until_known <http-port> <party>
  local deadline=$((SECONDS + KNOWN_DEADLINE_S))
  until api "$1" "/v2/parties/$2" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 0.5
  done
}
set_up() {
  synchronizer=$(api "$FIRST_HTTP_PORT" /v2/state/connected-synchronizers |
    jq --raw-output --exit-status --arg alias "$SYNCHRONIZER_ALIAS" \
      '.connectedSynchronizers[] | select(.synchronizerAlias == $alias).synchronizerId') || return 1
  local port
  for port in "$FIRST_HTTP_PORT" "$second_http_port"; do
    api "$port" "/v2/packages?synchronizerId=$synchronizer" --request POST \
      --header 'Content-Type: application/octet-stream' --data-binary "@$dar" >/dev/null || return 1
  done
  dso=$(allocate_party "$FIRST_HTTP_PORT" dso) || return 1
  alice=$(allocate_party "$FIRST_HTTP_PORT" alice) || return 1
  bob=$(allocate_party "$second_http_port" bob) || return 1
  wait_until_known "$FIRST_HTTP_PORT" "$bob" || return 1
  wait_until_known "$second_http_port" "$dso" || return 1
  wait_until_known "$second_http_port" "$alice" || return 1
}

setup_started_ns=$(date +%s%N)
state=passed
set_up >"$run_dir/setup.log" 2>&1 || state=setup-failed
setup_ms=$((($(date +%s%N) - setup_started_ns) / 1000000))

script_ms=NA
if [[ "$state" == passed ]]; then
  jq --null-input --arg dso "$dso" --arg alice "$alice" --arg bob "$bob" \
    --argjson first "$FIRST_LEDGER_PORT" --argjson second "$second_ledger_port" '{
      default_participant: {host: "localhost", port: $first},
      participants: {one: {host: "localhost", port: $first}, two: {host: "localhost", port: $second}},
      party_participants: {($dso): "one", ($alice): "one", ($bob): "two"}
    }' >"$run_dir/participants.json"
  jq --null-input --arg dso "$dso" --arg alice "$alice" --arg bob "$bob" --argjson transfers "$transfers" \
    '{dso: $dso, alice: $alice, bob: $bob, transfers: $transfers}' >"$run_dir/input.json"
  script_started_ns=$(date +%s%N)
  # The script runner shares the network of the sandbox container, because the
  # sandbox binds its gRPC Ledger API to localhost.
  docker run --rm --network "container:$CONTAINER" --user "$(id -u):$(id -g)" \
    --env HOME="$HOME" --env PATH="$HOME/.dpm/bin:/opt/java/openjdk/bin:/usr/bin:/bin" \
    --volume "$HOME:$HOME" --workdir "$HARNESS_DIR" "$IMAGE" \
    dpm script --dar "$dar" --script-name SandboxTransfer:transferAcrossParticipants \
    --participant-config "$run_dir/participants.json" --input-file "$run_dir/input.json" \
    >"$run_dir/script.log" 2>&1 || state=script-failed
  script_ms=$((($(date +%s%N) - script_started_ns) / 1000000))
fi
memory_mib=$(($(docker exec "$CONTAINER" cat /sys/fs/cgroup/memory.current) / 1048576))
peak_mib=$(($(docker exec "$CONTAINER" cat /sys/fs/cgroup/memory.peak) / 1048576))
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$topology" "$transfers" "$ready_ms" "$setup_ms" "$script_ms" \
  "$memory_mib" "$peak_mib" "$state"
