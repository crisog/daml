#!/usr/bin/env bash
# Sandbox cold starts with the release as it is ("default") and with two
# settings that exist today ("both"): Canton's compiled startup script kept
# between starts, and a class-data archive from make-archive.sh. The two
# topologies and the two variants take turns.
# Usage: start-settings.sh <repetitions>
# Run fresh-host.sh with the sandbox phase first: it downloads the release.
set -uo pipefail

repetitions=${1:?repetitions}
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/results-start
readonly ARCHIVE=-XX:SharedArchiveFile=/canton/cds/sandbox.jsa
export CANTON_DIR="$WORK/canton-open-source-3.7.4" RESULTS_DIR="$OUT/sandbox"
mkdir -p "$OUT"

"$WORK/make-archive.sh" >"$OUT/archive.log" 2>&1
# One start of each topology that is not counted fills the script cache.
for topology in sandbox multi-sync; do
  SCRIPT_CACHE_DIR="$OUT/script-cache" "$WORK/bench.sh" "$topology-fill-cache" "$topology" 4 8g default \
    >>"$OUT/fill.tsv" 2>>"$OUT/sandbox.err"
done
for ((repetition = 1; repetition <= repetitions; repetition++)); do
  for topology in sandbox multi-sync; do
    "$WORK/bench.sh" "$topology-default-r$repetition" "$topology" 4 8g default \
      >>"$OUT/sandbox.tsv" 2>>"$OUT/sandbox.err"
    SCRIPT_CACHE_DIR="$OUT/script-cache" JAVA_OPTS_EXTRA=$ARCHIVE \
      "$WORK/bench.sh" "$topology-both-r$repetition" "$topology" 4 8g default \
      >>"$OUT/sandbox.tsv" 2>>"$OUT/sandbox.err"
  done
done
echo "exit=0" >"$OUT/EXIT"
