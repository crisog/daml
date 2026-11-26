#!/usr/bin/env bash
# Measures one start of the Splice LocalNet: time until every container is
# healthy, then memory per container after an idle window. It prints one
# tab-separated row per container and a total row, then removes the network.
#
# Usage: localnet.sh <label> <constraints> <profile>...
#   constraints  capped | uncapped   (with or without resource-constraints.yaml)
#   profile      sv, app-provider, app-user
#
# Environment:
#   LOCALNET_DIR  the cluster/compose/localnet directory of a Splice release (required)
#   IMAGE_TAG     Splice version of the images, such as 0.10.3 (required)
#   RESULTS_DIR   where logs are kept (required)
#   CPUSET        pin every container to these cores, such as 0-3, to model a
#                 machine with that many cores (optional)
#   RESTART       kill | stop | none   how the containers end before the restart
#                 from the existing volumes (default kill). "none" skips the restart.
#   OVERRIDE      more compose files, applied in turn after the constraints, such
#                 as a developer's own memory limits. Paths with no space,
#                 separated by spaces (optional)
#   EXTRA_TABLES  create this many empty tables before the restart, to make
#                 Postgres crash recovery slower (optional)
#   SERVICES      start only these compose services and the services they
#                 depend on, such as "postgres canton splice" for a LocalNet
#                 with no web UI and no nginx (optional). The restart test
#                 reads the scan API through nginx, so use RESTART=none with it.
#   WORKLOAD      a command to run on the healthy network before the restart,
#                 such as localnet-transfer-test.py. Its output goes to
#                 workload.log, and one WORKLOAD row reports its result and
#                 the memory after it (optional)
#   SAVE_VOLUMES  a tar file. After the measurements, stop the network and
#                 save its volumes there (optional). Use it one time, with no
#                 WORKLOAD, to keep the ledger of a new network.
#   PREPARED_VOLUMES  a tar file from SAVE_VOLUMES. Put those volumes in place
#                 before the start, so that LocalNet starts from that ledger
#                 and does not create a new network (optional). The time of
#                 the copy is part of the start time.
#   IDLE_SETTLE_S seconds of idle time before the memory reading (default 60)
#   KEEP          when set, leave the network and its volumes up at the end,
#                 for a test that needs a healthy LocalNet after this script
#                 (optional). Remove it with "docker compose down --volumes".
set -euo pipefail

readonly HEALTHY_DEADLINE_S=900
readonly IDLE_SETTLE_S=${IDLE_SETTLE_S:-60}
readonly PROJECT=canton-bench-localnet

label=${1:?label}
constraints=${2:?constraints}
shift 2
profiles=("$@")
((${#profiles[@]} > 0)) || { echo "at least one profile is required" >&2; exit 2; }
: "${LOCALNET_DIR:?LOCALNET_DIR is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
export LOCALNET_DIR IMAGE_TAG
restart_mode=${RESTART:-kill}
[[ "$restart_mode" == kill || "$restart_mode" == stop || "$restart_mode" == none ]] ||
  { echo "RESTART must be kill, stop or none" >&2; exit 2; }

profile_state() { [[ " ${profiles[*]} " == *" $1 "* ]] && echo on || echo off; }
export SV_PROFILE APP_PROVIDER_PROFILE APP_USER_PROFILE
SV_PROFILE=$(profile_state sv)
APP_PROVIDER_PROFILE=$(profile_state app-provider)
APP_USER_PROFILE=$(profile_state app-user)

compose_args=(--project-name "$PROJECT"
  --env-file "$LOCALNET_DIR/compose.env" --env-file "$LOCALNET_DIR/env/common.env"
  --file "$LOCALNET_DIR/compose.yaml")
case "$constraints" in
  capped) compose_args+=(--file "$LOCALNET_DIR/resource-constraints.yaml") ;;
  uncapped) ;;
  *) echo "constraints must be capped or uncapped" >&2; exit 2 ;;
esac
for profile in "${profiles[@]}"; do
  compose_args+=(--profile "$profile")
done
read -r -a overrides <<<"${OVERRIDE:-}"
for override in ${overrides[@]+"${overrides[@]}"}; do
  [[ -f "$override" ]] || { echo "OVERRIDE is not a file: $override" >&2; exit 2; }
  compose_args+=(--file "$override")
done
compose() { docker compose "${compose_args[@]}" "$@"; }

run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"

if [[ -n "${CPUSET:-}" ]]; then
  {
    echo "services:"
    compose config --services | while read -r service; do
      printf '  %s:\n    cpuset: "%s"\n' "$service" "$CPUSET"
    done
  } >"$run_dir/cpuset.yaml"
  compose_args+=(--file "$run_dir/cpuset.yaml")
fi
# Runs a command as root in the Postgres image, with every volume of the
# project under /volumes and the directory of a tar file under /transfer.
in_volumes() { # in_volumes <tar-file> <command> <argument>...
  local file=$1 mounts=() volume
  shift
  for volume in $(docker volume ls --quiet --filter "label=com.docker.compose.project=$PROJECT"); do
    mounts+=(--volume "$volume:/volumes/$volume")
  done
  docker run --rm --user 0 --entrypoint "$1" "${mounts[@]}" --volume "$(dirname "$file"):/transfer" \
    "$(docker inspect --format '{{.Config.Image}}' postgres)" "${@:2}"
}
cleanup() {
  # The health probes explain a start that compose ends with "unhealthy".
  compose ps --all >"$run_dir/ps.txt" 2>&1 || true
  docker inspect --format '{{.Name}} {{json .State.Health}}' canton splice postgres >"$run_dir/health.txt" 2>&1 || true
  compose logs --timestamps >"$run_dir/compose.log" 2>&1 || true
  if [[ -n "${SAVE_VOLUMES:-}" ]]; then
    # Postgres needs the time for its last checkpoint, so that the saved files need no recovery.
    compose stop --timeout 60 >"$run_dir/stop.log" 2>&1
    in_volumes "$SAVE_VOLUMES" tar --create --numeric-owner --file "/transfer/$(basename "$SAVE_VOLUMES")" \
      --directory /volumes . >>"$run_dir/stop.log" 2>&1
  fi
  [[ -n "${KEEP:-}" ]] && return
  compose down --volumes >"$run_dir/down.log" 2>&1 || true
}
trap cleanup EXIT

load_before=$(cut -d' ' -f1 /proc/loadavg)
started_ns=$(date +%s%N)
read -r -a services <<<"${SERVICES:-}"
if [[ -n "${PREPARED_VOLUMES:-}" ]]; then
  # Compose creates the containers and the empty volumes, and the saved files
  # replace what the images put in the volumes.
  compose up --no-start ${services[@]+"${services[@]}"} >"$run_dir/create.log" 2>&1
  in_volumes "$PREPARED_VOLUMES" find /volumes -mindepth 2 -delete >>"$run_dir/create.log" 2>&1
  in_volumes "$PREPARED_VOLUMES" tar --extract --numeric-owner --same-owner \
    --file "/transfer/$(basename "$PREPARED_VOLUMES")" --directory /volumes >>"$run_dir/create.log" 2>&1
fi
# Compose waits here for each container that another one depends on. A splice
# container that never reports healthy would hold it for hours.
if ! timeout "$HEALTHY_DEADLINE_S" docker compose "${compose_args[@]}" up --detach \
  ${services[@]+"${services[@]}"} >"$run_dir/up.log" 2>&1; then
  printf '%s\t%s\t%s\tTOTAL\tNA\tNA\tNA\tup-failed\t%s\n' "$label" "$constraints" "${profiles[*]}" "$load_before"
  exit 0
fi

# A container without a health check reports an empty health value.
all_healthy() {
  local states
  states=$(compose ps --all --format '{{.Health}}')
  [[ -n "$states" ]] && ! grep --quiet --extended-regexp 'starting|unhealthy' <<<"$states"
}
deadline=$((SECONDS + HEALTHY_DEADLINE_S))
until all_healthy; do
  if ((SECONDS >= deadline)); then
    compose ps --all >"$run_dir/ps-at-deadline.txt" 2>&1 || true
    printf '%s\t%s\t%s\tTOTAL\tNA\tNA\tNA\tnot-healthy\t%s\n' "$label" "$constraints" "${profiles[*]}" "$load_before"
    exit 0
  fi
  sleep 2
done
healthy_ms=$((($(date +%s%N) - started_ns) / 1000000))

sleep "$IDLE_SETTLE_S" # an idle window to sample, not a readiness wait

total_current=0
total_peak=0
while read -r container; do
  current=$(($(docker exec "$container" cat /sys/fs/cgroup/memory.current) / 1048576))
  peak=$(($(docker exec "$container" cat /sys/fs/cgroup/memory.peak) / 1048576))
  limit=$(docker inspect --format '{{.HostConfig.Memory}}' "$container")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$constraints" "${profiles[*]}" \
    "$container" "$current" "$peak" "$((limit / 1048576))" running "$load_before"
  total_current=$((total_current + current))
  total_peak=$((total_peak + peak))
done < <(compose ps --format '{{.Name}}' | sort)

printf '%s\t%s\t%s\tTOTAL\t%s\t%s\tNA\thealthy_ms=%s\t%s\n' "$label" "$constraints" "${profiles[*]}" \
  "$total_current" "$total_peak" "$healthy_ms" "$load_before"

# Live heap of each JVM after a full collection, next to its heap limit. This
# runs after the memory rows, so the collection does not change them.
for jvm_container in canton splice; do
  heap_file="$run_dir/heap-$jvm_container.txt"
  docker exec "$jvm_container" sh -c \
    'pid=$(pgrep -o java) && jcmd "$pid" GC.run >/dev/null && jcmd "$pid" GC.heap_info && jcmd "$pid" VM.flags' \
    >"$heap_file" 2>&1 || continue
  live_heap_mib=$(awk '
    /Metaspace/ { exit }
    match($0, /used [0-9]+K/) { total += substr($0, RSTART + 5, RLENGTH - 6) }
    END { print int(total / 1024) }' "$heap_file")
  heap_max=$(grep --only-matching -- '-XX:MaxHeapSize=[0-9]*' "$heap_file" | cut -d= -f2) || heap_max=0
  printf '%s\t%s\t%s\t%s-jvm-heap\t%s\tNA\t%s\tlive-after-gc\t%s\n' "$label" "$constraints" "${profiles[*]}" \
    "$jvm_container" "$live_heap_mib" "$((heap_max / 1048576))" "$load_before"
done

if [[ -n "${WORKLOAD:-}" ]]; then
  workload_state=passed
  workload_started_ns=$(date +%s%N)
  bash -c "$WORKLOAD" >"$run_dir/workload.log" 2>&1 || workload_state=failed
  workload_ms=$((($(date +%s%N) - workload_started_ns) / 1000000))
  after_current=0
  after_peak=0
  oom_kills=0
  while read -r container; do
    after_current=$((after_current + $(docker exec "$container" cat /sys/fs/cgroup/memory.current) / 1048576))
    after_peak=$((after_peak + $(docker exec "$container" cat /sys/fs/cgroup/memory.peak) / 1048576))
    oom_kills=$((oom_kills + $(docker exec "$container" awk '$1 == "oom_kill" { print $2 }' /sys/fs/cgroup/memory.events)))
  done < <(compose ps --format '{{.Name}}')
  printf '%s\t%s\t%s\tWORKLOAD\t%s\t%s\tNA\tworkload=%s,workload_ms=%s,oom_kills=%s\t%s\n' "$label" "$constraints" "${profiles[*]}" \
    "$after_current" "$after_peak" "$workload_state" "$workload_ms" "$oom_kills" "$load_before"
fi

[[ "$restart_mode" != none ]] || exit 0

# Restart from the existing volumes, as a sandbox resumed from a disk snapshot
# does. "kill" models a snapshot of a running LocalNet: SIGKILL loses memory, and
# Postgres must recover from its write-ahead log. "stop" models a snapshot taken
# after a clean shutdown.
# The DSO party carries the key fingerprint of this network, so the same value
# after the restart means the network kept its state and did not initialize again.
dso_party() {
  curl --silent --show-error --fail --max-time 30 --header 'Host: scan.localhost' \
    "http://127.0.0.1:${SV_UI_PORT:-4000}/api/scan/v0/dso-party-id" | jq --raw-output '.dso_party_id'
}
dso_before=$(dso_party)
# More tables make crash recovery slower, because recovery syncs every file.
# This tests the restart when recovery takes longer than the startup timeouts.
if [[ -n "${EXTRA_TABLES:-}" ]]; then
  docker exec --interactive postgres sh -c \
    'psql --quiet --username "${POSTGRES_USER:?}" --dbname postgres --file -' \
    >"$run_dir/extra-tables.log" 2>&1 <<SQL
SET synchronous_commit = off;
SELECT format('CREATE TABLE filler_%s (id int PRIMARY KEY, v text)', n)
FROM generate_series(1, $EXTRA_TABLES) AS n \gexec
SQL
fi
# Postgres crash recovery syncs every file of its data directory, so the file
# count explains the recovery time. The first line is files, the second databases.
docker exec postgres sh -c 'find "$PGDATA" -type f | wc -l; ls "$PGDATA/base" | wc -l' \
  >"$run_dir/postgres-files.txt" 2>&1 || true
ended_ns=$(date +%s%N)
compose "$restart_mode" >"$run_dir/end.log" 2>&1
# "kill" returns when it has sent the signal. A start that comes before a
# container has exited does nothing to it, and compose then reports the exit.
compose ps --all --quiet | xargs --no-run-if-empty docker wait >/dev/null
restarted_ns=$(date +%s%N)
end_ms=$(((restarted_ns - ended_ns) / 1000000))
restart_state=healthy
start_attempts=1
if ! compose start >"$run_dir/start.log" 2>&1; then
  # start.log names the container that did not start. One more start shows
  # whether the failure is permanent.
  start_attempts=2
  compose start >"$run_dir/start-retry.log" 2>&1 || restart_state=start-failed
fi
if [[ "$restart_state" == healthy ]]; then
  deadline=$((SECONDS + HEALTHY_DEADLINE_S))
  until all_healthy; do
    if ((SECONDS >= deadline)); then
      restart_state=not-healthy
      break
    fi
    sleep 2
  done
fi
restart_ms=$((($(date +%s%N) - restarted_ns) / 1000000))
dso_after=$(dso_party 2>>"$run_dir/start.log" || echo unavailable)
# "unchecked" means the scan API did not answer, so the network is down and the
# volumes may still hold the ledger.
ledger=lost
if [[ "$dso_after" == unavailable ]]; then
  ledger=unchecked
elif [[ -n "$dso_before" && "$dso_before" == "$dso_after" ]]; then
  ledger=kept
fi
printf '%s\t%s\t%s\tRESTART\tNA\tNA\tNA\t%s_ms=%s,restart_ms=%s,starts=%s,%s,ledger=%s\t%s\n' "$label" "$constraints" "${profiles[*]}" \
  "$restart_mode" "$end_ms" "$restart_ms" "$start_attempts" "$restart_state" "$ledger" "$load_before"
