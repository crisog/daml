#!/usr/bin/env bash
# Repeats on boat.dev three tests that first ran on a machine of our own:
#   heap     the three-participant sandbox with the default heap, and with a
#            256 MiB heap and the G1 collector: three starts each, in turns
#   restart  the Canton network with file storage: 8 runs, each with a kill
#            and a second start (restart.sh own-config)
#   decode   the package decode of the Splice apps alone (splice-decode.sc):
#            the path of the release and the path that skips an archive it has
#            parsed, four runs each, in turns
# Usage: own-machine-reruns.sh
# Run fresh-host.sh with the sandbox phase first: it downloads the release.
set -uo pipefail

readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-reruns
readonly SPLICE_IMAGE=ghcr.io/digital-asset/decentralized-canton-sync/docker/splice-app:0.10.3
export CANTON_DIR="$WORK/canton-open-source-3.7.4"
mkdir -p "$OUT/decode"

for run in 1 2 3; do
  RESULTS_DIR="$OUT/heap" "$WORK/bench.sh" "multi-sync-default-r$run" multi-sync 4 8g default \
    >>"$OUT/heap.tsv" 2>>"$OUT/heap.err"
  RESULTS_DIR="$OUT/heap" JAVA_OPTS_EXTRA=-XX:+UseG1GC "$WORK/bench.sh" "multi-sync-256m-g1-r$run" multi-sync 4 8g 256m \
    >>"$OUT/heap.tsv" 2>>"$OUT/heap.err"
done

for run in 1 2 3 4 5 6 7 8; do
  RESULTS_DIR="$OUT/restart" "$WORK/restart.sh" "own-r$run" 4 8g own-config \
    >>"$OUT/restart.tsv" 2>>"$OUT/restart.err"
done

cp "$WORK/splice-decode.sc" "$OUT/decode/decode.sc"
printf 'canton {}\n' >"$OUT/decode/empty.conf"
docker pull --quiet "$SPLICE_IMAGE" >/dev/null
for run in 1 2 3 4; do
  for variant in release entries; do
    docker run --rm --cpus 4 --memory 3g --entrypoint /app/splice-node/bin/splice-node \
      --env "VARIANT=$variant" --volume "$OUT/decode:/work:ro" "$SPLICE_IMAGE" \
      run /work/decode.sc -c /work/empty.conf --no-tty 2>&1 |
      grep --extended-regexp 'RESULT|SECONDS' | tr '\n' ' ' >>"$OUT/decode.txt"
    echo >>"$OUT/decode.txt"
  done
done
echo "exit=0" >"$OUT/EXIT"
