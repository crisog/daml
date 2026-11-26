#!/usr/bin/env bash
# Runs the measurements on a machine that has none of the inputs yet, such as a
# rented agent sandbox. It times each download, because the first test on a new
# machine pays for it, and then runs bench.sh and localnet.sh unchanged.
#
# Usage: fresh-host.sh <cpus> <memory> <phase>...
#   cpus, memory  limits of the sandbox container. Use the size of the machine, such as 4 8g.
#   sandbox   downloads the Canton release and the Java image, then starts the
#             one-participant and the three-participant sandbox, in turns
#   localnet  downloads the Splice source and the LocalNet images, then starts LocalNet
#
# Environment:
#   BENCH_DIR    where downloads and results go (default ~/canton-bench)
#   REPETITIONS  cold starts of each network (default 6)
#
# Results go to <BENCH_DIR>/results:
#   host.txt      CPU model, CPU count, memory, swap, disk, versions, kernel OOM kills
#   setup.tsv     step, milliseconds
#   sandbox.tsv   one bench.sh row per start
#   localnet.tsv  the localnet.sh rows of each start
#   memory.tsv    epoch seconds, available MiB, free swap MiB, every 5 seconds
#
# Requires docker with compose, curl and tar. It installs jq with apt-get when jq is missing.
set -euo pipefail

readonly CANTON_VERSION=3.7.4
readonly CANTON_URL="https://github.com/digital-asset/canton/releases/download/v$CANTON_VERSION/canton-open-source-$CANTON_VERSION.tar.gz"
readonly SPLICE_VERSION=0.10.3
readonly SPLICE_COMMIT=76100713f7604eb26dc3538136faca4a072b9a9e
readonly SPLICE_URL="https://github.com/canton-network/splice/archive/$SPLICE_COMMIT.tar.gz"
readonly JAVA_IMAGE=eclipse-temurin:21-jdk
readonly MEMORY_SAMPLE_S=5
readonly SANDBOX_HEADER=$'label\ttopology\tparticipants\tcpus\tmemory\theap\tready_ms\theap_max_mib\tcollector\tidle_cgroup_mib\tidle_rss_mib\tpost_cgroup_mib\tpeak_cgroup_mib\tpeak_rss_mib\tlive_heap_mib\tthreads\tworkload_ms\tworkload\thost_load'

cpus=${1:?cpus}
memory=${2:?memory}
shift 2
(($# > 0)) || { echo "at least one phase is required" >&2; exit 2; }
repetitions=${REPETITIONS:-6}
work=${BENCH_DIR:-$HOME/canton-bench}
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
readonly SCRIPTS
readonly RESULTS="$work/results"
mkdir -p "$RESULTS"

command -v jq >/dev/null || sudo apt-get install --yes --quiet jq >/dev/null

record_step() { # record_step <step> <command...>
  local step=$1 started_ns
  shift
  started_ns=$(date +%s%N)
  "$@"
  printf '%s\t%s\n' "$step" "$((($(date +%s%N) - started_ns) / 1000000))" >>"$RESULTS/setup.tsv"
}

download() { # download <url> <file>
  curl --fail --silent --show-error --location --output "$2" "$1"
}

{
  echo "cpu: $(grep --max-count=1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)"
  echo "cpus: $(nproc)"
  grep --extended-regexp '^(MemTotal|SwapTotal):' /proc/meminfo
  echo "disk: $(df --output=source,fstype,size,avail --block-size=G / | tail -1 | xargs)"
  echo "kernel: $(uname -r)"
  docker --version
  docker compose version
} >"$RESULTS/host.txt"

# Runs until the script exits: the EXIT trap below ends it.
sample_memory() {
  while true; do
    awk -v now="$(date +%s)" '
      $1 == "MemAvailable:" { available = int($2 / 1024) }
      $1 == "SwapFree:" { swap = int($2 / 1024) }
      END { printf "%s\t%s\t%s\n", now, available, swap }' /proc/meminfo
    sleep "$MEMORY_SAMPLE_S"
  done >>"$RESULTS/memory.tsv"
}
sample_memory &
readonly SAMPLER=$!

# The kernel log shows whether the machine, and not a container limit, ran out of memory.
finish() {
  kill "$SAMPLER" 2>/dev/null || true
  local oom_kills
  oom_kills=$(sudo --non-interactive dmesg 2>/dev/null | grep --count --ignore-case 'out of memory') || true
  echo "kernel_oom_kills: ${oom_kills:-unknown}" >>"$RESULTS/host.txt"
}
trap finish EXIT

run_sandbox_phase() {
  export CANTON_DIR="$work/canton-open-source-$CANTON_VERSION"
  if [[ ! -d "$CANTON_DIR" ]]; then
    record_step canton-download download "$CANTON_URL" "$work/canton.tar.gz"
    record_step canton-extract tar --extract --gzip --file "$work/canton.tar.gz" --directory "$work"
  fi
  record_step java-image-pull docker pull --quiet "$JAVA_IMAGE"

  local table="$RESULTS/sandbox.tsv" repetition topology
  [[ -s "$table" ]] || echo "$SANDBOX_HEADER" >"$table"
  # The two topologies take turns, so a slow period on the machine affects both.
  for ((repetition = 1; repetition <= repetitions; repetition++)); do
    for topology in sandbox multi-sync; do
      RESULTS_DIR="$RESULTS/sandbox" "$SCRIPTS/bench.sh" \
        "$topology-c$cpus-m$memory-hdefault-r$repetition" "$topology" "$cpus" "$memory" default | tee -a "$table"
    done
  done
}

pull_localnet_images() {
  SV_PROFILE=on APP_PROVIDER_PROFILE=on APP_USER_PROFILE=on docker compose \
    --env-file "$LOCALNET_DIR/compose.env" --env-file "$LOCALNET_DIR/env/common.env" \
    --file "$LOCALNET_DIR/compose.yaml" \
    --profile sv --profile app-provider --profile app-user pull --quiet
}

run_localnet_phase() {
  local source_dir="$work/splice-$SPLICE_COMMIT"
  export LOCALNET_DIR="$source_dir/cluster/compose/localnet" IMAGE_TAG=$SPLICE_VERSION
  if [[ ! -d "$source_dir" ]]; then
    record_step splice-download download "$SPLICE_URL" "$work/splice.tar.gz"
    record_step splice-extract tar --extract --gzip --file "$work/splice.tar.gz" --directory "$work"
  fi
  sha256sum "$LOCALNET_DIR/compose.yaml" "$LOCALNET_DIR/resource-constraints.yaml" >"$RESULTS/localnet-files.sha256"
  record_step localnet-image-pull pull_localnet_images

  local repetition
  for ((repetition = 1; repetition <= repetitions; repetition++)); do
    RESULTS_DIR="$RESULTS/localnet" "$SCRIPTS/localnet.sh" \
      "all-capped-r$repetition" capped sv app-provider app-user | tee -a "$RESULTS/localnet.tsv"
  done
}

for phase in "$@"; do
  case "$phase" in
    sandbox) run_sandbox_phase ;;
    localnet) run_localnet_phase ;;
    *)
      echo "unknown phase: $phase" >&2
      exit 2
      ;;
  esac
done
