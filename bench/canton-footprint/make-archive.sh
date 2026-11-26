#!/usr/bin/env bash
# Creates a JVM class-data-sharing archive for the Canton sandbox. The JVM
# records the classes it loaded and writes the archive when it exits, so this
# starts a sandbox, waits until it is ready, and stops it with SIGTERM.
# The archive goes to <CANTON_DIR>/cds/sandbox.jsa, which a later run reads with
# JAVA_OPTS_EXTRA=-XX:SharedArchiveFile=/canton/cds/sandbox.jsa
#
# The archive is valid only for the same Java image and the same Canton release.
#
# Environment:
#   CANTON_DIR  extracted canton-open-source release (required)
#   IMAGE       Java image (default eclipse-temurin:21-jdk)
set -euo pipefail

readonly READY_DEADLINE_S=300
readonly STOP_DEADLINE_S=120
readonly READY_LINE='Canton sandbox is ready.'
readonly CONTAINER=canton-bench-archive

: "${CANTON_DIR:?CANTON_DIR is required}"
IMAGE=${IMAGE:-eclipse-temurin:21-jdk}

work_dir=$(mktemp --directory)
# The sandbox runs as root in the container, so root owns its files in the work
# directory. A container removes them, and the host then removes the directory.
cleanup() {
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
  docker run --rm --volume "$work_dir:/work" "$IMAGE" sh -c 'rm -rf /work/*' >/dev/null 2>&1 || true
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT

docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
docker run --detach --name "$CONTAINER" --cpus 4 --memory 8g \
  --env "JAVA_OPTS=-XX:ArchiveClassesAtExit=/work/sandbox.jsa" \
  --volume "$CANTON_DIR:/canton:ro" --volume "$work_dir:/work" --workdir /work \
  "$IMAGE" /canton/bin/canton sandbox >/dev/null

if ! timeout "$READY_DEADLINE_S" grep --max-count=1 --quiet --fixed-strings "$READY_LINE" \
  < <(docker logs --follow "$CONTAINER" 2>&1); then
  echo "the sandbox did not become ready" >&2
  docker logs --tail 20 "$CONTAINER" >&2
  exit 1
fi

docker stop --time "$STOP_DEADLINE_S" "$CONTAINER" >/dev/null
if [[ ! -s "$work_dir/sandbox.jsa" ]]; then
  echo "the JVM wrote no archive; the last log lines follow" >&2
  docker logs --tail 20 "$CONTAINER" >&2
  exit 1
fi

mkdir -p "$CANTON_DIR/cds"
cp "$work_dir/sandbox.jsa" "$CANTON_DIR/cds/sandbox.jsa"
echo "archive: $CANTON_DIR/cds/sandbox.jsa ($(($(stat --format %s "$CANTON_DIR/cds/sandbox.jsa") / 1048576)) MiB)"
