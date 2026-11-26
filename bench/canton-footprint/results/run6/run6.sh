#!/usr/bin/env bash
# Sandbox cold starts with settings that exist today, in turns:
#   default   the release as it is
#   cache     Canton's compiled startup script kept between starts (~/.ammonite)
#   archive   a class-data archive from make-archive.sh
#   both      cache and archive
#   both-c1   cache, archive, and the JIT limited to its first compiler
# The container is pinned to cores 8-11, so LocalNet can use cores 0-3.
cd ~/canton-bench || exit 1
export CANTON_DIR=$PWD/dl/canton-open-source-3.7.4 RESULTS_DIR=$PWD/results/run6/sandbox CPUSET=8-11
readonly ARCHIVE=-XX:SharedArchiveFile=/canton/cds/sandbox.jsa
out=results/run6
cache=$PWD/$out/script-cache
topology=${1:-sandbox}
# One start that is not counted fills the script cache.
SCRIPT_CACHE_DIR=$cache ./bench.sh "$topology-fill-cache" "$topology" 4 8g default >>$out/fill.tsv 2>>$out/sandbox.err
for r in 1 2 3 4; do
  ./bench.sh "$topology-default-r$r" "$topology" 4 8g default >>$out/sandbox.tsv 2>>$out/sandbox.err
  SCRIPT_CACHE_DIR=$cache ./bench.sh "$topology-cache-r$r" "$topology" 4 8g default >>$out/sandbox.tsv 2>>$out/sandbox.err
  JAVA_OPTS_EXTRA=$ARCHIVE ./bench.sh "$topology-archive-r$r" "$topology" 4 8g default >>$out/sandbox.tsv 2>>$out/sandbox.err
  SCRIPT_CACHE_DIR=$cache JAVA_OPTS_EXTRA=$ARCHIVE ./bench.sh "$topology-both-r$r" "$topology" 4 8g default >>$out/sandbox.tsv 2>>$out/sandbox.err
  SCRIPT_CACHE_DIR=$cache JAVA_OPTS_EXTRA="$ARCHIVE -XX:TieredStopAtLevel=1" ./bench.sh "$topology-both-c1-r$r" "$topology" 4 8g default >>$out/sandbox.tsv 2>>$out/sandbox.err
done
echo finished >"$out/EXIT-$topology"
