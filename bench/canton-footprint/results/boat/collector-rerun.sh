#!/usr/bin/env bash
# Repeats on boat.dev the collector example of the post: the three-participant
# sandbox with a 256 MiB heap and 2 CPUs, in a 2 GiB container, in a 1.5 GiB
# container, and in a 1.5 GiB container with -XX:+UseG1GC. Two runs each, in
# turns. It then counts the HEAP_MEMORY_OVER_LIMIT lines in the logs of each run.
# Usage: collector-rerun.sh
set -uo pipefail

readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-collector
export CANTON_DIR="$WORK/canton-open-source-3.7.4"
export RESULTS_DIR="$OUT/runs"
mkdir -p "$OUT"

for run in 1 2; do
  "$WORK/bench.sh" "multi-sync-c2-m2g-h256m-r$run" multi-sync 2 2g 256m >>"$OUT/collector.tsv" 2>>"$OUT/collector.err"
  "$WORK/bench.sh" "multi-sync-c2-m1536m-h256m-r$run" multi-sync 2 1536m 256m >>"$OUT/collector.tsv" 2>>"$OUT/collector.err"
  JAVA_OPTS_EXTRA=-XX:+UseG1GC "$WORK/bench.sh" "multi-sync-c2-m1536m-h256m-g1-r$run" multi-sync 2 1536m 256m \
    >>"$OUT/collector.tsv" 2>>"$OUT/collector.err"
done
for run_dir in "$RESULTS_DIR"/*/; do
  printf '%s\t%s\n' "$(basename "$run_dir")" "$(grep --recursive --no-filename --count HEAP_MEMORY_OVER_LIMIT "$run_dir" | paste -sd+ | bc)" \
    >>"$OUT/rejections.tsv"
done
echo "exit=0" >"$OUT/EXIT"
