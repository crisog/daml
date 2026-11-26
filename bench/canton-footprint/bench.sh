#!/usr/bin/env bash
# Measures one Canton sandbox topology in a resource-limited Docker container:
# time to ready, memory when idle and after a ledger workload, and the live heap.
# It prints one tab-separated result row and keeps the container log.
#
# Usage: bench.sh <label> <topology> <cpus> <memory> <heap>
#   topology  sandbox | multi-sync | participants:N   (N participants, one synchronizer)
#   cpus      Docker CPU limit, such as 4
#   memory    Docker memory limit, such as 8g
#   heap      JVM max heap, such as 1g, or "default" to let the JVM choose
#
# Environment:
#   CANTON_DIR   extracted canton-open-source release (required)
#   RESULTS_DIR  where logs are kept (required)
#   IMAGE        Java image (default eclipse-temurin:21-jdk)
#   JAVA_OPTS_EXTRA  more JVM options, such as -XX:NativeMemoryTracking=summary
#   CPUSET           pin the container to these cores, such as 8-11 (optional)
#   SCRIPT_CACHE_DIR  a host directory to mount as ~/.ammonite, where Canton
#                     keeps its compiled startup script. A new container has
#                     an empty one, so Canton compiles the script at each start.
#
# Requires docker, curl and jq on the host. The host must reach container IPs.
set -euo pipefail

readonly READY_DEADLINE_S=300
readonly IDLE_SETTLE_S=15
readonly HTTP_TIMEOUT_S=30
readonly PROPAGATION_DEADLINE_S=60
readonly ROUND_TRIPS_PER_PAIR=5
readonly PARTICIPANTS_MAX=16
readonly PING_TEMPLATE='#canton-builtin-admin-workflow-ping:Canton.Internal.Ping:Ping'
readonly READY_LINE='Canton sandbox is ready.'

label=${1:?label}
topology=${2:?topology}
cpus=${3:?cpus}
memory=${4:?memory}
heap=${5:?heap}
: "${CANTON_DIR:?CANTON_DIR is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}

container="canton-bench-$label"
run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"

# Each participant is "name:http_port". The first one is the sandbox default.
participants=("sandbox:6864")
canton_args=(sandbox)
case "$topology" in
  sandbox) ;;
  multi-sync)
    participants+=("pebblebox:7864" "sidebox:8864")
    canton_args+=(--multi-sync)
    ;;
  participants:*)
    count=${topology#participants:}
    if ! [[ "$count" =~ ^[0-9]+$ ]] || ((count < 1 || count > PARTICIPANTS_MAX)); then
      echo "participants:N needs N between 1 and $PARTICIPANTS_MAX" >&2
      exit 2
    fi
    for ((i = 2; i <= count; i++)); do
      participants+=("p$i:$((10000 + i * 10))")
    done
    ;;
  *)
    echo "unknown topology: $topology" >&2
    exit 2
    ;;
esac

# The sandbox binds to localhost. The host drives the workload over the
# container network, so every participant's JSON API must listen on all interfaces.
{
  for entry in "${participants[@]}"; do
    name=${entry%%:*}
    http_port=${entry##*:}
    echo "canton.participants.$name.http-ledger-api.address = \"0.0.0.0\""
    if [[ "$name" == p[0-9]* ]]; then
      echo "canton.participants.$name.http-ledger-api.port = $http_port"
      echo "canton.participants.$name.ledger-api.port = $((http_port + 1))"
      echo "canton.participants.$name.admin-api.port = $((http_port + 2))"
      echo "canton.participants.$name.storage.type = memory"
    fi
  done
} >"$run_dir/topology.conf"

# --memory-swap equal to --memory gives the container no swap, so a run that
# needs more than the limit is killed and does not pass by swapping.
docker_args=(--detach --name "$container" --cpus "$cpus" --memory "$memory" --memory-swap "$memory"
  --volume "$CANTON_DIR:/canton:ro" --volume "$run_dir:/work" --workdir /work)
if [[ -n "${CPUSET:-}" ]]; then
  docker_args+=(--cpuset-cpus "$CPUSET")
fi
if [[ -n "${SCRIPT_CACHE_DIR:-}" ]]; then
  mkdir -p "$SCRIPT_CACHE_DIR"
  docker_args+=(--volume "$SCRIPT_CACHE_DIR:/root/.ammonite")
fi
java_opts=${JAVA_OPTS_EXTRA:-}
if [[ "$heap" != default ]]; then
  java_opts="-Xmx$heap $java_opts"
fi
if [[ -n "$java_opts" ]]; then
  docker_args+=(--env "JAVA_OPTS=$java_opts")
fi

cleanup() {
  docker logs --timestamps "$container" >"$run_dir/container.log" 2>&1 || true
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm --force "$container" >/dev/null 2>&1 || true
load_before=$(cut -d' ' -f1 /proc/loadavg)
docker run "${docker_args[@]}" "$IMAGE" /canton/bin/canton "${canton_args[@]}" \
  -c /work/topology.conf >/dev/null

in_container() { docker exec "$container" "$@"; }
mib() { echo $(($1 / 1048576)); }
cgroup_mib() {
  local bytes
  bytes=$(in_container cat "/sys/fs/cgroup/$1") || return 1
  mib "$bytes"
}
jvm_status_mib() { in_container awk -v key="$1:" '$1 == key { print int($2 / 1024) }' /proc/1/status; }

emit_row() {
  printf '%s\t' "$label" "$topology" "${#participants[@]}" "$cpus" "$memory" "$heap" "$@"
  printf '%s\n' "$load_before"
}

# The log stream ends when the container stops, so a crash ends the wait early.
ready=yes
timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
  < <(docker logs --follow "$container" 2>&1) || ready=no

if [[ "$ready" == no ]]; then
  state=$(docker inspect --format 'exit={{.State.ExitCode}},oom={{.State.OOMKilled}},running={{.State.Running}}' "$container")
  emit_row NA NA NA NA NA NA NA NA NA NA NA "not-ready:$state"
  exit 0
fi

started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container")
ready_at=$(docker logs --timestamps "$container" 2>&1 | grep --max-count=1 --fixed-strings "$READY_LINE" | cut -d' ' -f1)
ready_ms=$((($(date --date "$ready_at" +%s%N) - $(date --date "$started_at" +%s%N)) / 1000000))

jvm_flags=$(in_container jcmd 1 VM.flags)
heap_max_mib=$(mib "$(grep --only-matching -- '-XX:MaxHeapSize=[0-9]*' <<<"$jvm_flags" | cut -d= -f2)")
collector=$(grep --only-matching --extended-regexp 'Use(G1|Serial|Parallel|Z|Shenandoah)GC' <<<"$jvm_flags" | head -1)

sleep "$IDLE_SETTLE_S" # an idle window to sample, not a readiness wait
idle_cgroup_mib=$(cgroup_mib memory.current)
idle_rss_mib=$(jvm_status_mib VmRSS)

container_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
# Prints the response body. On an HTTP error it reports the status and the body
# on stderr, which the workload log keeps, and returns 1.
api() { # api <http_port> <method> <path> [json-body]
  local port=$1 method=$2 path=$3 body=${4:-} status
  local curl_args=(--silent --show-error --max-time "$HTTP_TIMEOUT_S" --request "$method"
    --output "$run_dir/response.json" --write-out '%{http_code}')
  if [[ -n "$body" ]]; then
    curl_args+=(--header 'Content-Type: application/json' --data "$body")
  fi
  status=$(curl "${curl_args[@]}" "http://$container_ip:$port$path") || return 1
  if [[ "$status" != 2* ]]; then
    echo "HTTP $status on $method $path (port $port): $(head --bytes 500 "$run_dir/response.json")" >&2
    return 1
  fi
  cat "$run_dir/response.json"
}

synchronizer_id() { # synchronizer_id <http_port> <alias>
  api "$1" GET /v2/state/connected-synchronizers |
    jq --raw-output --arg alias "$2" '.connectedSynchronizers[] | select(.synchronizerAlias == $alias) | .synchronizerId' | head -1
}

allocate_party() { # allocate_party <http_port> <hint> <synchronizer-id>
  api "$1" POST /v2/parties "$(jq --null-input --arg hint "$2" --arg sync "$3" \
    '{partyIdHint: $hint, identityProviderId: "", synchronizerId: $sync}')" |
    jq --raw-output '.partyDetails.party'
}

submit() { # submit <http_port> <acting-party> <command-json>
  api "$1" POST /v2/commands/submit-and-wait "$(jq --null-input --arg party "$2" --argjson command "$3" \
    --arg id "bench-$RANDOM-$RANDOM" '{commands: [$command], commandId: $id, userId: "bench", actAs: [$party]}')" >/dev/null
}

# Retries until the deadline, because a new party reaches other participants
# through the synchronizer a moment after its allocation returns.
until_deadline() { # until_deadline <seconds> <command...>
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep 0.5
  done
}

ping_contract_id() { # ping_contract_id <http_port> <party> <ping-id>
  local offset
  offset=$(api "$1" GET /v2/state/ledger-end | jq '.offset')
  api "$1" POST /v2/state/active-contracts "$(jq --null-input --arg party "$2" --argjson offset "$offset" \
    '{activeAtOffset: $offset, eventFormat: {filtersByParty: {($party): {cumulative: [{identifierFilter: {WildcardFilter: {value: {includeCreatedEventBlob: false}}}}]}}}}')" |
    jq --raw-output --exit-status --arg id "$3" \
      '[.[] | .contractEntry.JsActiveContract.createdEvent | select(.createArgument.id == $id) | .contractId][0] // empty | select(. != "")'
}

ping_is_archived() { ! ping_contract_id "$@" >/dev/null; }

# One round trip: the initiator creates a Ping on its participant, the responder
# sees it on its own participant and exercises Respond there, and the initiator
# then sees the Ping archived. The caller runs this inside "||", where bash turns
# errexit off, so every step returns its failure explicitly.
round_trip() { # round_trip <initiator-port> <initiator> <responder-port> <responder> <ping-id>
  local create contract_id exercise
  create=$(jq --null-input --arg template "$PING_TEMPLATE" --arg id "$5" --arg initiator "$2" --arg responder "$4" \
    '{CreateCommand: {templateId: $template, createArguments: {id: $id, initiator: $initiator, responder: $responder}}}')
  until_deadline "$PROPAGATION_DEADLINE_S" submit "$1" "$2" "$create" || return 1
  contract_id=$(until_deadline "$PROPAGATION_DEADLINE_S" ping_contract_id "$3" "$4" "$5") || return 1
  exercise=$(jq --null-input --arg template "$PING_TEMPLATE" --arg contract "$contract_id" \
    '{ExerciseCommand: {templateId: $template, contractId: $contract, choice: "Respond", choiceArgument: {}}}')
  submit "$3" "$4" "$exercise" || return 1
  until_deadline "$PROPAGATION_DEADLINE_S" ping_is_archived "$1" "$2" "$5" || return 1
}

# Pairs are "initiator-port responder-port synchronizer-alias". Together they
# make every participant and every synchronizer process transactions.
pairs=()
case "$topology" in
  multi-sync) pairs=("6864 7864 synchronizer-1" "7864 8864 synchronizer-2") ;;
  *)
    if ((${#participants[@]} == 1)); then
      pairs=("6864 6864 synchronizer-1")
    else
      for entry in "${participants[@]:1}"; do
        pairs+=("6864 ${entry##*:} synchronizer-1")
      done
    fi
    ;;
esac

run_workload() {
  local pair initiator_port responder_port alias sync initiator responder n
  for pair in "${pairs[@]}"; do
    read -r initiator_port responder_port alias <<<"$pair"
    sync=$(synchronizer_id "$initiator_port" "$alias") || return 1
    [[ -n "$sync" ]] || return 1
    initiator=$(allocate_party "$initiator_port" "alice-$responder_port" "$sync") || return 1
    responder=$(allocate_party "$responder_port" "bob-$responder_port" "$sync") || return 1
    for ((n = 1; n <= ROUND_TRIPS_PER_PAIR; n++)); do
      round_trip "$initiator_port" "$initiator" "$responder_port" "$responder" "ping-$responder_port-$n" || return 1
      echo "round trip ok: $initiator_port -> $responder_port on $alias ($n of $ROUND_TRIPS_PER_PAIR)"
    done
  done
}

workload_started_ns=$(date +%s%N)
workload=ok
run_workload >"$run_dir/workload.log" 2>&1 || workload=failed
workload_ms=$((($(date +%s%N) - workload_started_ns) / 1000000))

# jcmd starts a second JVM inside the container. In a container at its memory
# limit that can get the sandbox killed, so a probe that fails is reported in the
# row and the fields it did not reach stay NA.
post_cgroup_mib=NA
peak_cgroup_mib=NA
peak_rss_mib=NA
threads=NA
live_heap_mib=NA
read_after_workload() {
  post_cgroup_mib=$(cgroup_mib memory.current) || return 1
  peak_cgroup_mib=$(cgroup_mib memory.peak) || return 1
  peak_rss_mib=$(jvm_status_mib VmHWM) || return 1
  threads=$(in_container awk '$1 == "Threads:" { print $2 }' /proc/1/status) || return 1
  # Without -XX:NativeMemoryTracking the JVM answers that tracking is off.
  in_container jcmd 1 VM.native_memory summary >"$run_dir/native-memory.txt" 2>&1 || true
  in_container jcmd 1 GC.run >/dev/null || return 1
  # G1 reports one "used" figure for the heap. The serial collector reports one
  # per generation, so the figures before the Metaspace section are summed.
  live_heap_mib=$(in_container jcmd 1 GC.heap_info | awk '
    /Metaspace/ { exit }
    match($0, /used [0-9]+K/) { total += substr($0, RSTART + 5, RLENGTH - 6) }
    END { print int(total / 1024) }') || return 1
}
if ! read_after_workload; then
  workload="$workload,probe-failed:$(docker inspect --format 'exit={{.State.ExitCode}},oom={{.State.OOMKilled}},running={{.State.Running}}' "$container")"
fi

emit_row "$ready_ms" "$heap_max_mib" "$collector" "$idle_cgroup_mib" "$idle_rss_mib" \
  "$post_cgroup_mib" "$peak_cgroup_mib" "$peak_rss_mib" "$live_heap_mib" "$threads" "$workload_ms" "$workload"
