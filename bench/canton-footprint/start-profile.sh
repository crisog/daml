#!/usr/bin/env bash
# Profiles one Canton sandbox start, from container start to the ready line.
# It keeps three things in <RESULTS_DIR>/<label>:
#   start.jfr      a Java Flight Recorder file that ends at the ready line
#   threads.tsv    the CPU time of each JVM thread at the ready line (name, ns)
#   log/canton.log and container.log, with a timestamp on each line
# It prints one tab-separated row: label, topology, cpus, memory, cache, ready_ms.
#
# Usage: start-profile.sh <label> <topology> <cpus> <memory>
#   topology  sandbox | multi-sync
#
# Environment:
#   CANTON_DIR        extracted canton-open-source release (required)
#   RESULTS_DIR       where the files are kept (required)
#   IMAGE             Java image (default eclipse-temurin:21-jdk)
#   SCRIPT_CACHE_DIR  a host directory to mount as ~/.ammonite, where Canton
#                     keeps its compiled startup script (optional)
#   JAVA_OPTS_EXTRA   more JVM options (optional)
set -euo pipefail

readonly READY_DEADLINE_S=300
readonly READY_LINE='Canton sandbox is ready.'

label=${1:?label}
topology=${2:?topology}
cpus=${3:?cpus}
memory=${4:?memory}
: "${CANTON_DIR:?CANTON_DIR is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}

case "$topology" in
  sandbox) canton_args=(sandbox) ;;
  multi-sync) canton_args=(sandbox --multi-sync) ;;
  *) echo "topology must be sandbox or multi-sync" >&2; exit 2 ;;
esac

container="canton-profile-$label"
run_dir="$RESULTS_DIR/$label"
mkdir -p "$run_dir"

docker_args=(--detach --name "$container" --cpus "$cpus" --memory "$memory" --memory-swap "$memory"
  --volume "$CANTON_DIR:/canton:ro" --volume "$run_dir:/work" --workdir /work
  --env "JAVA_OPTS=-XX:StartFlightRecording=name=start,settings=profile ${JAVA_OPTS_EXTRA:-}")
cache=empty
if [[ -n "${SCRIPT_CACHE_DIR:-}" ]]; then
  mkdir -p "$SCRIPT_CACHE_DIR"
  [[ -z "$(ls -A "$SCRIPT_CACHE_DIR")" ]] || cache=kept
  docker_args+=(--volume "$SCRIPT_CACHE_DIR:/root/.ammonite")
fi

cleanup() {
  docker logs --timestamps "$container" >"$run_dir/container.log" 2>&1 || true
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm --force "$container" >/dev/null 2>&1 || true
docker run "${docker_args[@]}" "$IMAGE" /canton/bin/canton "${canton_args[@]}" >/dev/null

timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
  < <(docker logs --follow "$container" 2>&1)

# The JVM is process 1 of the container. schedstat starts with the CPU time in ns.
# A thread can end between the listing and the read, so a failed read is skipped.
docker exec "$container" sh -c \
  'for task in /proc/1/task/*; do
     name=$(cat "$task/comm" 2>/dev/null) && nanos=$(cut -d" " -f1 "$task/schedstat" 2>/dev/null) &&
       printf "%s\t%s\n" "$name" "$nanos"
   done; true' >"$run_dir/threads.tsv"
docker exec "$container" jcmd 1 JFR.dump name=start filename=/work/start.jfr >"$run_dir/jfr-dump.log" 2>&1

started_at=$(docker inspect --format '{{.State.StartedAt}}' "$container")
ready_at=$(docker logs --timestamps "$container" 2>&1 | grep --max-count=1 --fixed-strings "$READY_LINE" | cut -d' ' -f1)
ready_ms=$((($(date --date "$ready_at" +%s%N) - $(date --date "$started_at" +%s%N)) / 1000000))
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$topology" "$cpus" "$memory" "$cache" "$ready_ms"
