#!/usr/bin/env bash
# Runs measurement phases with bench.sh and appends one row per run to
# <RESULTS_ROOT>/<phase>.tsv. Container logs go to <RESULTS_ROOT>/<phase>/<label>/.
#
# Usage: matrix.sh <phase>...
#   topologies  cost of each topology at 4 CPUs, 8 GiB, default heap
#   heap-floor  smallest JVM heap that starts and passes the workload
#   cpus        time to ready against the CPU limit
#   heap-boundary    repeats around the smallest working heap
#   container-floor  smallest container memory limit at a 256 MiB heap, 2 CPUs
#   small-container  the same limits with the G1 collector forced
#   small-container-serial  a 1280 MiB container with the serial collector and a 384 MiB heap
#   native-memory    one run per topology with JVM native memory tracking on
#   class-sharing-off, class-sharing-on
#                    time to ready without and with a class-data-sharing archive
#
# Environment: CANTON_DIR and RESULTS_ROOT are required.
set -euo pipefail

: "${CANTON_DIR:?CANTON_DIR is required}"
: "${RESULTS_ROOT:?RESULTS_ROOT is required}"
readonly BENCH="$(cd "$(dirname "$0")" && pwd)/bench.sh"
readonly HEADER=$'label\ttopology\tparticipants\tcpus\tmemory\theap\tready_ms\theap_max_mib\tcollector\tidle_cgroup_mib\tidle_rss_mib\tpost_cgroup_mib\tpeak_cgroup_mib\tpeak_rss_mib\tlive_heap_mib\tthreads\tworkload_ms\tworkload\thost_load'

run_case() { # run_case <phase> <topology> <cpus> <memory> <heap> <repetitions>
  local phase=$1 topology=$2 cpus=$3 memory=$4 heap=$5 repetitions=$6
  local table="$RESULTS_ROOT/$phase.tsv" repetition label
  [[ -s "$table" ]] || echo "$HEADER" >"$table"
  for ((repetition = 1; repetition <= repetitions; repetition++)); do
    label="${topology//:/}-c$cpus-m$memory-h$heap-r$repetition"
    RESULTS_DIR="$RESULTS_ROOT/$phase" "$BENCH" "$label" "$topology" "$cpus" "$memory" "$heap" | tee -a "$table"
  done
}

for phase in "$@"; do
  case "$phase" in
    topologies)
      for topology in sandbox multi-sync; do
        run_case "$phase" "$topology" 4 8g default 5
      done
      for topology in participants:2 participants:3 participants:5 participants:8; do
        run_case "$phase" "$topology" 4 8g default 3
      done
      ;;
    heap-floor)
      for topology in sandbox multi-sync; do
        for heap in 1g 512m 384m 256m 192m 128m; do
          run_case "$phase" "$topology" 4 8g "$heap" 1
        done
      done
      ;;
    cpus)
      for topology in sandbox multi-sync; do
        for cpus in 1 2 8; do
          run_case "$phase" "$topology" "$cpus" 8g default 3
        done
      done
      ;;
    heap-boundary)
      for topology in sandbox multi-sync; do
        for heap in 256m 224m; do
          run_case "$phase" "$topology" 4 8g "$heap" 2
        done
      done
      ;;
    container-floor)
      for topology in sandbox multi-sync; do
        for memory in 2g 1536m 1280m 1g; do
          run_case "$phase" "$topology" 2 "$memory" 256m 2
        done
      done
      ;;
    small-container)
      # Below 1792 MiB of container memory the JVM picks the serial collector,
      # whose old generation is two thirds of the heap. The Ledger API rejects
      # requests when the old generation is full, so G1 is forced here to keep
      # the collector of the larger containers.
      for topology in sandbox multi-sync; do
        for memory in 1536m 1280m 1g; do
          JAVA_OPTS_EXTRA=-XX:+UseG1GC run_case "$phase" "$topology" 2 "$memory" 256m 2
        done
      done
      ;;
    small-container-serial)
      # The other way to fit: keep the serial collector and raise the heap until
      # its old generation holds the live data.
      for topology in sandbox multi-sync; do
        run_case "$phase" "$topology" 2 1280m 384m 2
      done
      ;;
    class-sharing-off | class-sharing-on)
      # The two phases run the same cases, so they can alternate under the same
      # host load. The "on" phase needs the archive from make-archive.sh.
      options=
      if [[ "$phase" == class-sharing-on ]]; then
        options=-XX:SharedArchiveFile=/canton/cds/sandbox.jsa
      fi
      for cpus in 4 1; do
        JAVA_OPTS_EXTRA=$options run_case "$phase" sandbox "$cpus" 8g default 3
      done
      ;;
    native-memory)
      for topology in sandbox multi-sync; do
        JAVA_OPTS_EXTRA=-XX:NativeMemoryTracking=summary run_case "$phase" "$topology" 4 8g 256m 1
      done
      ;;
    *)
      echo "unknown phase: $phase" >&2
      exit 2
      ;;
  esac
done
