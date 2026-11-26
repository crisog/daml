#!/usr/bin/env bash
# Checks whether a Canton sandbox with file-backed storage keeps its ledger when
# the process is killed, and measures the second start. This models a disk
# snapshot of a sandbox: memory is lost and files are kept.
# It prints one tab-separated row: label, cpus, memory, first_ready_ms,
# second_ready_ms, storage_mib, state. State is "kept" when a party and an
# active contract from before the kill are still there after the restart.
#
# Usage: restart.sh <label> <cpus> <memory> <setup>
#   setup  inherit | memory  the sandbox command with file storage for its three
#                            nodes. The ordering layer inside the BFT sequencer
#                            keeps its blocks in the sequencer's storage (inherit)
#                            or in memory (memory, the sandbox default).
#          own-config        the daemon command with restartable.conf and
#                            restartable-bootstrap.canton: a developer's own
#                            configuration, with every node on file storage
#
# Environment:
#   CANTON_DIR   extracted canton-open-source release (required)
#   RESULTS_DIR  where logs and the storage files are kept (required)
#   IMAGE        Java image (default eclipse-temurin:21-jdk)
set -euo pipefail

readonly READY_DEADLINE_S=300
readonly HTTP_TIMEOUT_S=30
readonly HTTP_PORT=6864
readonly PING_TEMPLATE='#canton-builtin-admin-workflow-ping:Canton.Internal.Ping:Ping'
readonly READY_LINE='Canton sandbox is ready.'

label=${1:?label}
cpus=${2:?cpus}
memory=${3:?memory}
setup=${4:?setup}
[[ "$setup" == inherit || "$setup" == memory || "$setup" == own-config ]] ||
  { echo "setup must be inherit, memory or own-config" >&2; exit 2; }
: "${CANTON_DIR:?CANTON_DIR is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}

container="canton-restart-$label"
run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"
# The first start must begin with an empty ledger.
[[ ! -e "$run_dir/data" ]] || { echo "$run_dir/data exists; use a new label" >&2; exit 2; }

# The three nodes get one H2 database file each under <run_dir>/data.
# Canton 3.7.4 rejects "h2" as the value of the ordering layer's own storage
# setting, so "inherit" removes that setting and the layer uses the sequencer's.
h2_options='MODE=PostgreSQL;LOCK_TIMEOUT=10000;DB_CLOSE_DELAY=-1'
if [[ "$setup" == own-config ]]; then
  scripts=$(cd "$(dirname "$0")" && pwd)
  cp "$scripts/restartable.conf" "$scripts/restartable-bootstrap.canton" "$run_dir/"
  canton_args=(daemon -c /work/restartable.conf --bootstrap /work/restartable-bootstrap.canton)
else
  {
    echo 'include required(file("/canton/config/storage/h2.conf"))'
    for node in participants.sandbox mediators.mediator1 sequencers.sequencer1; do
      echo "canton.$node.storage = \${_shared.storage}"
      echo "canton.$node.storage.config.url = \"jdbc:h2:file:/work/data/${node#*.};$h2_options\""
    done
    if [[ "$setup" == inherit ]]; then
      echo 'canton.sequencers.sequencer1.sequencer.config.storage = null'
    fi
    echo 'canton.participants.sandbox.http-ledger-api.address = "0.0.0.0"'
  } >"$run_dir/topology.conf"
  canton_args=(sandbox -c /work/topology.conf)
fi

cleanup() { docker rm --force "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Starts the sandbox and prints the time to ready in milliseconds.
# It returns 1 when the sandbox stops or misses the deadline.
start_sandbox() { # start_sandbox <log-name>
  docker rm --force "$container" >/dev/null 2>&1 || true
  docker run --detach --name "$container" --cpus "$cpus" --memory "$memory" \
    --volume "$CANTON_DIR:/canton:ro" --volume "$run_dir:/work" --workdir /work \
    "$IMAGE" /canton/bin/canton "${canton_args[@]}" >/dev/null
  local ready=yes started_at ready_at
  timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
    < <(docker logs --follow "$container" 2>&1) || ready=no
  docker logs --timestamps "$container" >"$run_dir/$1.log" 2>&1
  [[ "$ready" == yes ]] || return 1
  started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container")
  ready_at=$(grep --max-count=1 --fixed-strings "$READY_LINE" "$run_dir/$1.log" | cut -d' ' -f1)
  echo $((($(date --date "$ready_at" +%s%N) - $(date --date "$started_at" +%s%N)) / 1000000))
}

api() { # api <method> <path> [json-body]
  local ip
  ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
  if [[ -n "${3:-}" ]]; then
    curl --silent --show-error --fail-with-body --max-time "$HTTP_TIMEOUT_S" --request "$1" \
      --header 'Content-Type: application/json' --data "$3" "http://$ip:$HTTP_PORT$2"
  else
    curl --silent --show-error --fail-with-body --max-time "$HTTP_TIMEOUT_S" --request "$1" "http://$ip:$HTTP_PORT$2"
  fi
}

active_ping_count() { # active_ping_count <party>
  local offset
  offset=$(api GET /v2/state/ledger-end | jq '.offset')
  api POST /v2/state/active-contracts "$(jq --null-input --arg party "$1" --argjson offset "$offset" \
    '{activeAtOffset: $offset, eventFormat: {filtersByParty: {($party): {cumulative: [{identifierFilter: {WildcardFilter: {value: {includeCreatedEventBlob: false}}}}]}}}}')" |
    jq '[.[] | .contractEntry.JsActiveContract.createdEvent | select(.createArgument.id == "kept-across-restart")] | length'
}

emit_row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$cpus" "$memory" "$@"; }

first_ready_ms=$(start_sandbox first) || { emit_row NA NA NA "first-start-failed"; exit 0; }

sync=$(api GET /v2/state/connected-synchronizers | jq --raw-output '.connectedSynchronizers[0].synchronizerId')
party=$(api POST /v2/parties "$(jq --null-input --arg sync "$sync" \
  '{partyIdHint: "keeper", identityProviderId: "", synchronizerId: $sync}')" | jq --raw-output '.partyDetails.party')
api POST /v2/commands/submit-and-wait "$(jq --null-input --arg template "$PING_TEMPLATE" --arg party "$party" \
  '{commands: [{CreateCommand: {templateId: $template, createArguments: {id: "kept-across-restart", initiator: $party, responder: $party}}}],
    commandId: "create-kept-ping", userId: "bench", actAs: [$party]}')" >/dev/null
[[ "$(active_ping_count "$party")" == 1 ]] || { emit_row "$first_ready_ms" NA NA "setup-failed"; exit 0; }

docker kill "$container" >/dev/null # SIGKILL: no shutdown hook runs, as when memory is lost
[[ -d "$run_dir/data" ]] || { emit_row "$first_ready_ms" NA NA "no-storage-files"; exit 0; }
find "$run_dir/data" -type f -printf '%s %p\n' >"$run_dir/files-after-kill.txt"
storage_mib=$(awk '{ total += $1 } END { print int(total / 1048576) }' "$run_dir/files-after-kill.txt")

second_ready_ms=$(start_sandbox second) || { emit_row "$first_ready_ms" NA "$storage_mib" "second-start-failed"; exit 0; }

state=lost
if [[ "$(active_ping_count "$party" 2>"$run_dir/check.log")" == 1 ]]; then
  state=kept
fi
emit_row "$first_ready_ms" "$second_ready_ms" "$storage_mib" "$state"
