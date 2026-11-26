#!/usr/bin/env bash
# Measures the three-participant Canton sandbox as its ledger grows. It starts
# the sandbox with --multi-sync, creates a Canton Coin registry with no Splice
# app, and then adds Canton Coin holdings in steps. A wallet is a party that
# owns holdings. Half of the wallets are on the first participant and half are
# on the second. The DSO party is on the first participant, so that participant
# stores every holding. After each step it prints one tab-separated row: label,
# heap, axis, target, wallets, holdings, allocate_ms, load_ms, live_heap_mib,
# cgroup_mib, peak_mib, heap_rejections, state.
#   live_heap_mib    the heap after a forced collection
#   cgroup_mib       the memory of the sandbox container before that collection
#   heap_rejections  HEAP_MEMORY_OVER_LIMIT lines in the Canton log to this step
#   state            ok | setup-failed:<step> | load-failed | probe-failed. The
#                    run stops at the first step that is not ok.
# The first row has target 0: the sandbox with the registry and no wallet. Its
# allocate_ms is the time from the start of the container to the ready line,
# and its load_ms is the time of the setup: the package upload and the registry.
#
# Usage: sandbox-load.sh <label> <heap> <axis> <target>...
#   heap     default, or a JVM size such as 256m. A size also selects the G1
#            collector.
#   axis     contracts  10 wallets. Each target is a total number of holdings,
#                       divided equally among the wallets.
#            wallets    Each target is a total number of wallets. Each wallet
#                       gets one holding.
#   target   totals in rising order, each a multiple of 10
#
# Environment:
#   CANTON_DIR       extracted canton-open-source release (required)
#   HARNESS_DIR      the built coin-sandbox project (required)
#   RESULTS_DIR      where logs are kept (required)
#   IMAGE            Java image (default eclipse-temurin:21-jdk)
#   STEP_DEADLINE_S  the longest time for the holdings of one step (default 2400)
#   AFTER_LOAD       a command to run against the loaded sandbox before it
#                    stops, such as sandbox-registry-test.sh. It gets
#                    SANDBOX_ADDRESS, DSO and RUN_DIR, its output goes to
#                    after-load.log, and one more row with the axis
#                    "after-load" reports its result (optional)
# Requires docker, curl, jq, and dpm with the SDK of the project in ~/.dpm.
set -uo pipefail

readonly READY_DEADLINE_S=300
readonly KNOWN_DEADLINE_S=120
readonly UPLOAD_DEADLINE_S=300
readonly READY_LINE='Canton sandbox is ready.'
readonly CONTAINER=canton-bench-load
readonly RUNNER=canton-bench-load-runner
readonly SYNCHRONIZER_ALIAS=synchronizer-1
readonly FIRST_HTTP_PORT=6864
readonly FIRST_LEDGER_PORT=6865
readonly SECOND_HTTP_PORT=7864
readonly SECOND_LEDGER_PORT=7865
readonly CONTRACT_AXIS_WALLETS=10

label=${1:?label}
heap=${2:?heap}
axis=${3:?axis}
shift 3
targets=("$@")
((${#targets[@]} > 0)) || { echo "at least one target is required" >&2; exit 2; }
[[ "$axis" == contracts || "$axis" == wallets ]] || { echo "axis must be contracts or wallets" >&2; exit 2; }
: "${CANTON_DIR:?CANTON_DIR is required}"
: "${HARNESS_DIR:?HARNESS_DIR is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}
step_deadline_s=${STEP_DEADLINE_S:-2400}

run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"
dar=$(ls "$HARNESS_DIR"/.daml/dist/*.dar | head -1)
: >"$run_dir/wallets-one.txt"
: >"$run_dir/wallets-two.txt"

cat >"$run_dir/topology.conf" <<CONF
canton.participants.sandbox.http-ledger-api.address = "0.0.0.0"
canton.participants.pebblebox.http-ledger-api.address = "0.0.0.0"
CONF
docker_args=(--detach --name "$CONTAINER" --cpus 4 --memory 8g
  --volume "$CANTON_DIR:/canton:ro" --volume "$run_dir:/work" --workdir /work)
if [[ "$heap" != default ]]; then
  docker_args+=(--env "JAVA_OPTS=-Xmx$heap -XX:+UseG1GC")
fi

cleanup() {
  docker logs --timestamps "$CONTAINER" >"$run_dir/container.log" 2>&1 || true
  docker rm --force "$RUNNER" "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm --force "$RUNNER" "$CONTAINER" >/dev/null 2>&1 || true

emit_row() { # emit_row <target> <wallets> <holdings> <allocate_ms> <load_ms> <state>
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$heap" "$axis" "$1" "$2" "$3" "$4" "$5" \
    "$live_heap_mib" "$cgroup_mib" "$peak_mib" "$heap_rejections" "$6"
}
measure_reset() {
  live_heap_mib=NA
  cgroup_mib=NA
  peak_mib=NA
  heap_rejections=NA
}
measure_reset

started_ns=$(date +%s%N)
docker run "${docker_args[@]}" "$IMAGE" /canton/bin/canton sandbox --multi-sync -c /work/topology.conf >/dev/null
if ! timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
  <(docker logs --follow "$CONTAINER" 2>&1); then
  emit_row 0 0 0 NA NA sandbox-not-ready
  exit 0
fi

ready_ms=$((($(date +%s%N) - started_ns) / 1000000))

address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")
api() { # api <http-port> <path> [curl options]
  local port=$1 path=$2
  shift 2
  curl --silent --show-error --fail --max-time 120 "$@" "http://$address:$port$path"
}
# Each participant of this sandbox is on two synchronizers, so a request names one.
allocate_party() { # allocate_party <http-port> <hint>
  printf '{"partyIdHint": "%s", "identityProviderId": "", "synchronizerId": "%s"}' "$2" "$synchronizer" |
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
# Appends new wallets to the list of one participant.
allocate_wallets() { # allocate_wallets <http-port> <name> <list-file> <count>
  local port=$1 name=$2 list=$3 count=$4 first index party
  first=$(wc -l <"$list")
  for ((index = first + 1; index <= first + count; index++)); do
    party=$(allocate_party "$port" "$name-$index") || return 1
    echo "$party" >>"$list"
  done
}
write_participants() {
  jq --null-input --arg dso "$dso" --rawfile one "$run_dir/wallets-one.txt" --rawfile two "$run_dir/wallets-two.txt" \
    --argjson first "$FIRST_LEDGER_PORT" --argjson second "$SECOND_LEDGER_PORT" '
      def parties(text): text | split("\n") | map(select(length > 0));
      def hosted(text; name): parties(text) | map({(.): name}) | add // {};
      {
        default_participant: {host: "localhost", port: $first},
        participants: {one: {host: "localhost", port: $first}, two: {host: "localhost", port: $second}},
        party_participants: ({($dso): "one"} + hosted($one; "one") + hosted($two; "two"))
      }' >"$run_dir/participants.json"
}
# The script runner shares the network of the sandbox container, because the
# sandbox binds its gRPC Ledger API to localhost.
run_script() { # run_script <script> <input-file> <log-file>
  timeout "$step_deadline_s" docker run --rm --name "$RUNNER" --network "container:$CONTAINER" \
    --user "$(id -u):$(id -g)" --env HOME="$HOME" \
    --env PATH="$HOME/.dpm/bin:/opt/java/openjdk/bin:/usr/bin:/bin" \
    --volume "$HOME:$HOME" --workdir "$HARNESS_DIR" "$IMAGE" \
    dpm script --dar "$dar" --script-name "SandboxLoad:$1" \
    --participant-config "$run_dir/participants.json" --input-file "$2" >"$3" 2>&1
}
# It also keeps the largest classes of the heap in histogram-<target>.txt.
measure() { # measure <target>
  measure_reset
  local current_bytes peak_bytes
  current_bytes=$(docker exec "$CONTAINER" cat /sys/fs/cgroup/memory.current 2>/dev/null) || return 1
  peak_bytes=$(docker exec "$CONTAINER" cat /sys/fs/cgroup/memory.peak 2>/dev/null) || return 1
  cgroup_mib=$((current_bytes / 1048576))
  peak_mib=$((peak_bytes / 1048576))
  docker exec "$CONTAINER" jcmd 1 GC.run >/dev/null || return 1
  # G1 reports one "used" figure for the heap. awk reads all of the output: an
  # early exit closes the pipe, and docker exec then fails in some runs.
  live_heap_mib=$(docker exec "$CONTAINER" jcmd 1 GC.heap_info | awk '
    /Metaspace/ { heap_done = 1 }
    !heap_done && match($0, /used [0-9]+K/) { total += substr($0, RSTART + 5, RLENGTH - 6) }
    END { print int(total / 1024) }') || return 1
  docker exec "$CONTAINER" jcmd 1 GC.class_histogram 2>/dev/null | awk 'NR <= 45' >"$run_dir/histogram-$1.txt"
  # grep ends with 1 when it counts no line.
  heap_rejections=$({ grep --recursive --no-filename --count HEAP_MEMORY_OVER_LIMIT "$run_dir/log" || true; } | paste -sd+ | bc)
}
# The JSON API ends a request after 20 seconds, and the participant can still
# complete the upload after that. The upload is done when the participant
# lists the main package of the DAR.
upload_dar() { # upload_dar <http-port>
  api "$1" "/v2/packages?synchronizerId=$synchronizer" --request POST \
    --header 'Content-Type: application/octet-stream' --data-binary "@$dar" >/dev/null && return 0
  local deadline=$((SECONDS + UPLOAD_DEADLINE_S))
  until api "$1" /v2/packages | jq --exit-status --arg id "$main_package" '.packageIds | index($id)' >/dev/null; do
    ((SECONDS < deadline)) || return 1
    sleep 2
  done
}
set_up() {
  setup_step=synchronizer
  synchronizer=$(api "$FIRST_HTTP_PORT" /v2/state/connected-synchronizers |
    jq --raw-output --exit-status --arg alias "$SYNCHRONIZER_ALIAS" \
      '.connectedSynchronizers[] | select(.synchronizerAlias == $alias).synchronizerId') || return 1
  setup_step=upload
  upload_dar "$FIRST_HTTP_PORT" || return 1
  upload_dar "$SECOND_HTTP_PORT" || return 1
  setup_step=party
  dso=$(allocate_party "$FIRST_HTTP_PORT" dso) || return 1
  wait_until_known "$SECOND_HTTP_PORT" "$dso" || return 1
  setup_step=registry
  write_participants
  jq --null-input --arg dso "$dso" '{dso: $dso}' >"$run_dir/registry-input.json"
  run_script createRegistryOnly "$run_dir/registry-input.json" "$run_dir/registry.log"
}

main_package=$(dpm damlc inspect-dar --json "$dar" | jq --raw-output --exit-status '.main_package_id') ||
  { echo "cannot read the main package of $dar" >&2; exit 2; }
setup_started_ns=$(date +%s%N)
set_up >"$run_dir/setup.log" 2>&1 || setup_state="setup-failed:$setup_step"
setup_ms=$((($(date +%s%N) - setup_started_ns) / 1000000))
measure 0 || setup_state=${setup_state:-probe-failed}
emit_row 0 0 0 "$ready_ms" "$setup_ms" "${setup_state:-ok}"
[[ -z "${setup_state:-}" ]] || exit 0

wallets_each=0 # wallets on each participant
holdings_each=0 # holdings of each wallet
for target in "${targets[@]}"; do
  if [[ "$axis" == contracts ]]; then
    new_each=$((CONTRACT_AXIS_WALLETS / 2 - wallets_each))
    expected=$((target / CONTRACT_AXIS_WALLETS))
    holdings=$((expected - holdings_each))
  else
    new_each=$((target / 2 - wallets_each))
    expected=1
    holdings=1
  fi
  first_new=$((wallets_each + 1))
  state=ok
  allocate_started_ns=$(date +%s%N)
  if ((new_each > 0)); then
    {
      allocate_wallets "$FIRST_HTTP_PORT" one "$run_dir/wallets-one.txt" "$new_each" &&
        allocate_wallets "$SECOND_HTTP_PORT" two "$run_dir/wallets-two.txt" "$new_each" &&
        wait_until_known "$FIRST_HTTP_PORT" "$(tail -1 "$run_dir/wallets-two.txt")" &&
        wait_until_known "$SECOND_HTTP_PORT" "$(tail -1 "$run_dir/wallets-one.txt")"
    } >>"$run_dir/setup.log" 2>&1 || state=load-failed
  fi
  allocate_ms=$((($(date +%s%N) - allocate_started_ns) / 1000000))
  wallets_each=$((wallets_each + new_each))
  holdings_each=$expected

  load_ms=NA
  if [[ "$state" == ok ]]; then
    write_participants
    # The contracts axis adds holdings to every wallet. The wallets axis adds
    # one holding to each new wallet.
    from_line=1
    [[ "$axis" == wallets ]] && from_line=$first_new
    jq --null-input --arg dso "$dso" --argjson holdings "$holdings" --argjson expected "$expected" \
      --rawfile one <(tail -n "+$from_line" "$run_dir/wallets-one.txt") \
      --rawfile two <(tail -n "+$from_line" "$run_dir/wallets-two.txt") '
        def parties(text): text | split("\n") | map(select(length > 0));
        {dso: $dso, walletsOne: parties($one), walletsTwo: parties($two), holdings: $holdings, expected: $expected}
      ' >"$run_dir/step-$target.json"
    load_started_ns=$(date +%s%N)
    run_script addHoldings "$run_dir/step-$target.json" "$run_dir/step-$target.log" || state=load-failed
    load_ms=$((($(date +%s%N) - load_started_ns) / 1000000))
  fi
  measure "$target" || state="$state,probe-failed:$(docker inspect --format 'exit={{.State.ExitCode}},oom={{.State.OOMKilled}},running={{.State.Running}}' "$CONTAINER")"
  emit_row "$target" "$((wallets_each * 2))" "$((wallets_each * 2 * holdings_each))" "$allocate_ms" "$load_ms" "$state"
  [[ "$state" == ok ]] || break
done

if [[ -n "${AFTER_LOAD:-}" && "$state" == ok ]]; then
  after_started_ns=$(date +%s%N)
  SANDBOX_ADDRESS=$address DSO=$dso RUN_DIR=$run_dir bash -c "$AFTER_LOAD" >"$run_dir/after-load.log" 2>&1 ||
    state=after-load-failed
  after_ms=$((($(date +%s%N) - after_started_ns) / 1000000))
  axis=after-load
  measure after-load || state="$state,probe-failed"
  emit_row "${targets[-1]}" "$((wallets_each * 2))" "$((wallets_each * 2 * holdings_each))" 0 "$after_ms" "$state"
fi
