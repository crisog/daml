#!/usr/bin/env bash
# Checks whether a Canton sandbox that runs in a rented machine is still the same
# process after the provider stops and resumes the machine.
#
# Usage: warm-test.sh start <cpus> <memory>   start the three-participant sandbox and allocate a party
#        warm-test.sh state                    print what identifies the running process
#        warm-test.sh ready-after-resume       wait for the sandbox and print when it answered
set -euo pipefail

readonly CONTAINER=canton-warm
readonly READY_LINE='Canton sandbox is ready.'
readonly READY_DEADLINE_S=180
readonly PARTY_HINT=warm-alice
readonly API=http://localhost:6864

party_count() {
  curl --silent --max-time 5 "$API/v2/parties" |
    jq --arg hint "$PARTY_HINT" '[.partyDetails[].party | select(startswith($hint))] | length'
}

state() {
  echo "time: $(date -u +%H:%M:%S.%3NZ)"
  echo "container: $(docker inspect --format 'started_at={{.State.StartedAt}} running={{.State.Running}}' "$CONTAINER" 2>&1)"
  echo "parties_named_$PARTY_HINT: $(party_count 2>/dev/null || echo 'api did not answer')"
  echo "machine_uptime_s: $(cut -d' ' -f1 /proc/uptime)"
  echo "cpu: $(grep --max-count=1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)"
}

# Waits for the first ready line after the container's current start.
wait_ready() {
  local started_at
  started_at=$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")
  timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
    < <(docker logs --follow --since "$started_at" "$CONTAINER" 2>&1)
  local ready_at
  ready_at=$(docker logs --timestamps --since "$started_at" "$CONTAINER" 2>&1 |
    grep --max-count=1 --fixed-strings "$READY_LINE" | cut -d' ' -f1)
  echo "container_started_at: $started_at"
  echo "ready_at: $ready_at"
  echo "ready_ms: $((($(date --date "$ready_at" +%s%N) - $(date --date "$started_at" +%s%N)) / 1000000))"
}

case "${1:?command}" in
  start)
    docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
    # Host networking, so the sandbox's localhost ports are the machine's.
    docker run --detach --name "$CONTAINER" --network host --cpus "${2:?cpus}" --memory "${3:?memory}" \
      --volume "${WORK_DIR:?WORK_DIR}/canton-open-source-3.7.4:/canton:ro" --workdir /tmp \
      eclipse-temurin:21-jdk /canton/bin/canton sandbox --multi-sync >/dev/null
    wait_ready
    sync_id=$(curl --silent --max-time 30 "$API/v2/state/connected-synchronizers" |
      jq --raw-output '.connectedSynchronizers[] | select(.synchronizerAlias == "synchronizer-1") | .synchronizerId')
    curl --silent --max-time 30 --header 'Content-Type: application/json' \
      --data "$(jq --null-input --arg hint "$PARTY_HINT" --arg sync "$sync_id" \
        '{partyIdHint: $hint, identityProviderId: "", synchronizerId: $sync}')" \
      "$API/v2/parties" >/dev/null
    state
    ;;
  state) state ;;
  ready-after-resume)
    wait_ready
    state
    ;;
  *)
    echo "unknown command: $1" >&2
    exit 2
    ;;
esac
