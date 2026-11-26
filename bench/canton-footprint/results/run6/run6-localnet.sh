#!/usr/bin/env bash
# LocalNet cold starts with start settings that exist today, in turns:
#   shipped      the release as it is
#   info         both JVMs log at INFO (localnet-info-logs.yaml)
#   info-probe   INFO logs and a health probe every 5 s (localnet-info-logs-fast-probe.yaml)
# Pinned to cores 0-3. No restart.
cd ~/canton-bench || exit 1
export LOCALNET_DIR=$PWD/splice-0.10.3/cluster/compose/localnet IMAGE_TAG=0.10.3 DOCKER_CONFIG=$HOME/docker-anon RESULTS_DIR=$PWD/results/run6/localnet
export CPUSET=0-3 RESTART=none
out=results/run6
for r in 1 2 3; do
  ./localnet.sh "shipped-r$r" capped sv app-provider app-user >>$out/localnet.tsv 2>>$out/localnet.err
  OVERRIDE=$PWD/localnet-info-logs.yaml ./localnet.sh "info-r$r" capped sv app-provider app-user >>$out/localnet.tsv 2>>$out/localnet.err
  OVERRIDE=$PWD/localnet-info-logs-fast-probe.yaml ./localnet.sh "info-probe-r$r" capped sv app-provider app-user >>$out/localnet.tsv 2>>$out/localnet.err
done
echo finished >$out/EXIT-localnet
