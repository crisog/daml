#!/usr/bin/env bash
# Starts the Splice LocalNet and leaves it up, to check what a provider's stop
# and resume does to it.
#
# Usage: localnet-warm.sh start                  download, start, wait until healthy, print the state
#        localnet-warm.sh state                  print what identifies the running network
#        localnet-warm.sh healthy-after-resume   wait until the same containers run and are healthy
set -euo pipefail

readonly SPLICE_VERSION=0.10.3
readonly SPLICE_COMMIT=76100713f7604eb26dc3538136faca4a072b9a9e
readonly SPLICE_URL="https://github.com/canton-network/splice/archive/$SPLICE_COMMIT.tar.gz"
readonly PROJECT=canton-warm-localnet
readonly HEALTHY_DEADLINE_S=600
work=${WORK_DIR:?WORK_DIR}
readonly RUNNING_BEFORE="$work/localnet-warm-running.txt"
export LOCALNET_DIR="$work/splice-$SPLICE_COMMIT/cluster/compose/localnet" IMAGE_TAG=$SPLICE_VERSION
export SV_PROFILE=on APP_PROVIDER_PROFILE=on APP_USER_PROFILE=on

compose() {
  docker compose --project-name "$PROJECT" \
    --env-file "$LOCALNET_DIR/compose.env" --env-file "$LOCALNET_DIR/env/common.env" \
    --file "$LOCALNET_DIR/compose.yaml" --file "$LOCALNET_DIR/resource-constraints.yaml" \
    --profile sv --profile app-provider --profile app-user "$@"
}

running_names() { compose ps --format '{{.Name}}' | sort; }

# True when every container that ran before the stop runs again and none is
# starting or unhealthy. A container without a health check reports an empty value.
same_containers_healthy() {
  local states
  [[ "$(running_names)" == "$(cat "$RUNNING_BEFORE")" ]] || return 1
  states=$(compose ps --format '{{.Health}}')
  ! grep --quiet --extended-regexp 'starting|unhealthy' <<<"$states"
}

# The DSO party carries the key fingerprint of this network, so the same value
# after a resume means the network kept its state.
dso_party() {
  curl --silent --show-error --fail --max-time 30 --header 'Host: scan.localhost' \
    "http://127.0.0.1:${SV_UI_PORT:-4000}/api/scan/v0/dso-party-id" | jq --raw-output '.dso_party_id'
}

state() {
  echo "time: $(date -u +%H:%M:%S.%3NZ)"
  echo "machine_uptime_s: $(cut -d' ' -f1 /proc/uptime)"
  echo "cpu: $(grep --max-count=1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)"
  compose ps --all --format '{{.Name}} {{.State}} {{.Health}}' | sort | sed 's/^/container: /'
  echo "canton_started_at: $(docker inspect --format '{{.State.StartedAt}}' canton 2>&1)"
  echo "postgres_started_at: $(docker inspect --format '{{.State.StartedAt}}' postgres 2>&1)"
  echo "dso_party: $(dso_party 2>/dev/null || echo unavailable)"
  awk '$1 == "MemAvailable:" || $1 == "SwapFree:" { printf "%s %d MiB\n", $1, $2 / 1024 }' /proc/meminfo
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTHY_DEADLINE_S))
  until same_containers_healthy; do
    if ((SECONDS >= deadline)); then
      echo "not healthy after $HEALTHY_DEADLINE_S s"
      return 1
    fi
    sleep 2
  done
  echo "healthy_at: $(date -u +%H:%M:%S.%3NZ)"
}

case "${1:?command}" in
  start)
    if [[ ! -d "$work/splice-$SPLICE_COMMIT" ]]; then
      curl --fail --silent --show-error --location "$SPLICE_URL" | tar --extract --gzip --directory "$work"
    fi
    compose pull --quiet
    started_s=$SECONDS
    echo "up_at: $(date -u +%H:%M:%S.%3NZ)"
    compose up --detach >/dev/null 2>&1
    # The first wait has no earlier list, so it waits for the containers compose reports.
    deadline=$((SECONDS + HEALTHY_DEADLINE_S))
    until states=$(compose ps --all --format '{{.Health}}') && [[ -n "$states" ]] &&
      ! grep --quiet --extended-regexp 'starting|unhealthy' <<<"$states"; do
      ((SECONDS < deadline)) || { echo "not healthy after $HEALTHY_DEADLINE_S s"; exit 1; }
      sleep 2
    done
    echo "healthy after $((SECONDS - started_s)) s"
    running_names >"$RUNNING_BEFORE"
    state
    ;;
  state) state ;;
  healthy-after-resume)
    wait_healthy || true
    state
    ;;
  *)
    echo "unknown command: $1" >&2
    exit 2
    ;;
esac
