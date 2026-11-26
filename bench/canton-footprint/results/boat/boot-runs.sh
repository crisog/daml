#!/usr/bin/env bash
# What shortens a LocalNet start, on a boat.dev machine.
#
# Usage: boot-runs.sh compare <repetitions>
#          These cases, in turns:
#            cold      a new LocalNet as shipped
#            prepared  LocalNet as shipped, started from the saved volumes. It
#                      does not create a network: no new synchronizer, no
#                      upload of packages, no new validators.
#            parallel  prepared, with localnet-parallel-start.yaml (the Splice
#                      apps start with Canton, not after it) and
#                      localnet-fast-probe.yaml
#          The saved volumes of these cases are new-network.tar: a new
#          LocalNet, stopped 20 s after it was ready. Its validators have
#          bought no traffic at that moment.
#        boot-runs.sh io
#          One cold start with localnet-io-timing.yaml. Its workload log holds
#          the output of postgres-io.sh: the disk waits of Postgres.
#        boot-runs.sh nofsync <repetitions>
#          Cold starts with localnet-no-fsync.yaml.
#        boot-runs.sh usable-save
#          Create a LocalNet, wait until the app-user and the app-provider
#          validator have bought traffic, and save its volumes as
#          usable-network.tar. No transfer runs on it.
#        boot-runs.sh usable <repetitions>
#          Starts from usable-network.tar.
#        boot-runs.sh topup <repetitions>
#          Cold starts with "automation.topup-trigger-polling-interval = 1s"
#          for the validators, in conf/splice/app.conf. The release does not
#          set it, so the validators look for traffic to buy every 30 s.
#        boot-runs.sh aged <days>...
#          For each number, in turn: move the clock of the machine forward by
#          that many days, then start from usable-network.tar. The saved ledger
#          is then that much older than the clock. The clock returns to
#          network time at the end. Needs sudo.
# A run ends with the removal of the network and its volumes.
# Needs fresh-host.sh, bench.sh, localnet.sh, localnet-stages.py, postgres-io.sh,
# the four localnet-*.yaml files that this script names, localnet-transfer-test.py
# and localnet_wallet.py in ~/canton-bench.
# Results: ~/canton-bench/boot/
#   ready.tsv     label, ready_ms, first_transfer_ms: milliseconds from the
#                 start of the run. "Ready" is the first pass of the health
#                 check of the splice container, which this script runs every
#                 second. Docker runs it every 5 s at first and every 20 s
#                 later, so the "healthy" of localnet.tsv can be up to 20 s
#                 late. "First transfer" is the end of the first
#                 localnet-transfer-test.py with one transfer that passes; the
#                 script repeats that test from "ready".
#   localnet.tsv  the rows of localnet.sh. Its workload is 5 more transfers.
#   stages.txt    localnet-stages.py for the compose log of each run
#   first-transfer-<label>.log  the output of each attempt of the first transfer
# The saved volumes are in ~/canton-bench. An existing file is kept.
set -uo pipefail

phase=${1:?phase}
shift
readonly WORK=$HOME/canton-bench
readonly OUT=$WORK/boot
readonly PROJECT=canton-bench-localnet
readonly SAVED=$WORK/new-network.tar
readonly USABLE=$WORK/usable-network.tar
readonly TRAFFIC_BOUGHT='Successfully bought extra traffic'
readonly PARALLEL_START=$WORK/localnet-parallel-start.yaml
readonly FAST_PROBE=$WORK/localnet-fast-probe.yaml
readonly IO_TIMING=$WORK/localnet-io-timing.yaml
readonly NO_FSYNC=$WORK/localnet-no-fsync.yaml
readonly USABLE_DEADLINE_S=300
export LOCALNET_DIR="$WORK/splice-76100713f7604eb26dc3538136faca4a072b9a9e/cluster/compose/localnet"
export IMAGE_TAG=0.10.3 RESULTS_DIR="$OUT/localnet" RESTART=none IDLE_SETTLE_S=5
mkdir -p "$OUT"
cd "$WORK" || exit 1

docker compose --project-name "$PROJECT" down --volumes >/dev/null 2>&1
if [[ ! -d "$LOCALNET_DIR" ]]; then
  REPETITIONS=0 ./fresh-host.sh 4 8g localnet >"$OUT/setup.log" 2>&1
fi
readonly SPLICE_CONF=$LOCALNET_DIR/conf/splice/app.conf
# An earlier test can leave a setting of its own in the files of the release.
sed --in-place --regexp-extended 's/(max-connections = )[0-9]+/\132/' "$LOCALNET_DIR/conf/canton/app.conf" "$SPLICE_CONF"
sed --in-place '/topup-trigger-polling-interval/d' "$SPLICE_CONF"

save_network() { # save_network <label> <tar-file> [VARIABLE=value]...
  local label=$1 file=$2
  shift 2
  if [[ ! -f "$file" ]]; then
    env "$@" SAVE_VOLUMES="$file" ./localnet.sh "$label" capped sv app-provider app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  fi
  stat --format '%n: %s bytes, saved %y' "$file" >>"$OUT/saved.txt" 2>&1
}

elapsed_ms() { echo $((($(date +%s%N) - $1) / 1000000)); }

watch_start() { # watch_start <label>
  local started_ns ready_ms
  started_ns=$(date +%s%N)
  until docker exec splice bash /app/health-check.sh >/dev/null 2>&1; do sleep 1; done
  ready_ms=$(elapsed_ms "$started_ns")
  until python3 "$WORK/localnet-transfer-test.py" "$LOCALNET_DIR" 1 >>"$OUT/first-transfer-$1.log" 2>&1; do sleep 1; done
  printf '%s\t%s\t%s\n' "$1" "$ready_ms" "$(elapsed_ms "$started_ns")" >>"$OUT/ready.tsv"
  touch "$OUT/usable-$1"
}

run() { # run <label> <command after the 5 transfers, or ""> [VARIABLE=value]...
  local label=$1 after=$2 watcher
  shift 2
  watch_start "$label" &
  watcher=$!
  env "$@" WORKLOAD="timeout $USABLE_DEADLINE_S bash -c 'until [[ -f $OUT/usable-$label ]]; do sleep 1; done' \
    && python3 $WORK/localnet-transfer-test.py $LOCALNET_DIR 5 $after" \
    ./localnet.sh "$label" capped sv app-provider app-user >>"$OUT/localnet.tsv" 2>>"$OUT/localnet.err"
  # The watcher still runs only when no transfer passed.
  if kill "$watcher" 2>/dev/null; then
    printf '%s\tNA\tNA\n' "$label" >>"$OUT/ready.tsv"
  fi
  python3 ./localnet-stages.py "$OUT/localnet/$label/compose.log" >>"$OUT/stages.txt" 2>&1
}

case "$phase" in
  compare)
    repetitions=${1:?repetitions}
    save_network new-network "$SAVED"
    for ((repetition = 1; repetition <= repetitions; repetition++)); do
      run "cold-r$repetition" ""
      run "prepared-r$repetition" "" PREPARED_VOLUMES="$SAVED"
      run "parallel-r$repetition" "" PREPARED_VOLUMES="$SAVED" OVERRIDE="$PARALLEL_START $FAST_PROBE"
    done
    ;;
  io)
    run cold-io "&& bash $WORK/postgres-io.sh" OVERRIDE="$IO_TIMING"
    ;;
  nofsync)
    repetitions=${1:?repetitions}
    for ((repetition = 1; repetition <= repetitions; repetition++)); do
      run "cold-nofsync-r$repetition" "" OVERRIDE="$NO_FSYNC"
    done
    ;;
  usable-save)
    # Two validators buy traffic: app-user and app-provider. The SV's validator buys none.
    save_network usable-network "$USABLE" WORKLOAD="timeout $USABLE_DEADLINE_S \
      grep --max-count=2 \"$TRAFFIC_BOUGHT\" <(docker logs --follow splice 2>&1) >/dev/null"
    ;;
  usable)
    repetitions=${1:?repetitions}
    for ((repetition = 1; repetition <= repetitions; repetition++)); do
      run "usable-r$repetition" "" PREPARED_VOLUMES="$USABLE"
    done
    ;;
  topup)
    repetitions=${1:?repetitions}
    sed --in-place '/^_validator_backend {$/a\  automation.topup-trigger-polling-interval = 1s' "$SPLICE_CONF"
    grep --line-number 'topup-trigger-polling-interval' "$SPLICE_CONF" >"$OUT/topup-conf.txt"
    for ((repetition = 1; repetition <= repetitions; repetition++)); do
      run "cold-topup-r$repetition" ""
    done
    sed --in-place '/topup-trigger-polling-interval/d' "$SPLICE_CONF"
    ;;
  aged)
    sudo timedatectl set-ntp false
    for days in "$@"; do
      clock=$(sudo date --set "+$days days")
      echo "aged-${days}d: the clock of the machine is $clock" >>"$OUT/clock.txt"
      run "aged-${days}d" "" PREPARED_VOLUMES="$USABLE"
    done
    sudo timedatectl set-ntp true
    ;;
  *)
    echo "usage: boot-runs.sh compare <repetitions> | io | nofsync <repetitions> | usable-save | usable <repetitions> | topup <repetitions> | aged <days>..." >&2
    exit 2
    ;;
esac
echo finished >"$OUT/EXIT-$phase"
