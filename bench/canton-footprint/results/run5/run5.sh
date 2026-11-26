#!/usr/bin/env bash
# LocalNet restarts with a slow Postgres crash recovery: the shipped limits in
# turns with the developer override file. EXTRA_TABLES adds files that recovery
# must sync. Same pinning and restart mode as run4.
cd ~/canton-bench || exit 1
export LOCALNET_DIR=$PWD/splice-0.10.3/cluster/compose/localnet IMAGE_TAG=0.10.3 DOCKER_CONFIG=$HOME/docker-anon RESULTS_DIR=$PWD/results/run5/localnet
export CPUSET=0-3 RESTART=kill EXTRA_TABLES=8000
mkdir -p results/run5
for r in 1 2; do
  ./localnet.sh shipped-slow-recovery-r$r capped sv app-provider app-user >>results/run5/localnet.tsv 2>>results/run5/localnet.err
  OVERRIDE=$PWD/localnet-small-limits.yaml ./localnet.sh override-slow-recovery-r$r capped sv app-provider app-user >>results/run5/localnet.tsv 2>>results/run5/localnet.err
done
echo done >results/run5/EXIT
