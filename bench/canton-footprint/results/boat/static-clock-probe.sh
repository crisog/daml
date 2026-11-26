#!/usr/bin/env bash
# Do Splice's own transfer tests pass, with no change, against a Canton
# sandbox with one participant? The tests set the ledger time. Each test gets a
# new sandbox, because each test allocates the parties "alice" and "bob".
#   <test>             the sandbox and the script runner with --static-time
#   real-clock-<test>  both with their defaults (a wall clock), for the first test
# One row for each case: label, state, exit code of the script, milliseconds.
# Usage: static-clock-probe.sh [test]...
#   test  a script of Splice.Tests.TestAmuletTokenTransfer (default: all 11)
# Needs ~/cc-harness (the coin-sandbox project after prepare.sh) and
# fresh-host.sh and bench.sh in ~/canton-bench.
set -uo pipefail

readonly WORK=$HOME/canton-bench
readonly HARNESS=$HOME/cc-harness
readonly OUT=$HOME/static-clock
readonly IMAGE=eclipse-temurin:21-jdk
readonly CONTAINER=canton-bench-static
readonly MODULE=Splice.Tests.TestAmuletTokenTransfer
readonly ALL_TESTS=(test_expired test_happy_path_self test_happy_path_direct test_two_step_success
  test_two_step_withdraw test_two_step_withdraw_locked_amulet_gone test_two_step_reject
  test_two_step_reject_locked_amulet_gone test_no_holdings test_wrong_admin test_factory_PublicFetch)
tests=("$@")
((${#tests[@]} > 0)) || tests=("${ALL_TESTS[@]}")
export PATH="$HOME/.dpm/bin:$PATH"
mkdir -p "$OUT"
cd "$WORK" || exit 1

REPETITIONS=0 ./fresh-host.sh 4 8g sandbox >"$OUT/setup.log" 2>&1
if ! command -v dpm >/dev/null; then
  curl --fail --silent --show-error https://get.digitalasset.com/install/install.sh | sh >>"$OUT/setup.log" 2>&1
fi
dpm install 3.5.2 >>"$OUT/setup.log" 2>&1
(cd "$HARNESS" && dpm build >>"$OUT/setup.log" 2>&1)
docker pull --quiet "$IMAGE" >/dev/null
dar=$(ls "$HARNESS"/.daml/dist/*.dar | head -1)

probe() { # probe <label> <test> [flag]
  local label=$1 test=$2 flag=${3:-} run="$OUT/$1" state code=NA elapsed_ms=NA
  local flags=()
  [[ -n "$flag" ]] && flags=("$flag")
  mkdir -p "$run"
  echo 'canton.participants.sandbox.http-ledger-api.address = "0.0.0.0"' >"$run/topology.conf"
  docker rm --force "$CONTAINER" >/dev/null 2>&1
  docker run --detach --name "$CONTAINER" --cpus 4 --memory 8g \
    --volume "$WORK/canton-open-source-3.7.4:/canton:ro" --volume "$run:/work" --workdir /work \
    "$IMAGE" /canton/bin/canton sandbox ${flags[@]+"${flags[@]}"} -c /work/topology.conf >/dev/null
  state=ran
  if ! timeout 300 grep --max-count=1 --quiet --fixed-strings 'Canton sandbox is ready.' \
    <(docker logs --follow "$CONTAINER" 2>&1); then
    state=sandbox-not-ready
  else
    local address
    address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")
    if ! curl --silent --show-error --fail --max-time 120 --request POST \
      --header 'Content-Type: application/octet-stream' --data-binary "@$dar" \
      "http://$address:6864/v2/packages" >"$run/upload.log" 2>&1; then
      state=upload-failed
    else
      local started_ns
      started_ns=$(date +%s%N)
      docker run --rm --network "container:$CONTAINER" --user "$(id -u):$(id -g)" \
        --env HOME="$HOME" --env PATH="$HOME/.dpm/bin:/opt/java/openjdk/bin:/usr/bin:/bin" \
        --volume "$HOME:$HOME" --workdir "$HARNESS" "$IMAGE" \
        dpm script --dar "$dar" --script-name "$MODULE:$test" --ledger-host localhost --ledger-port 6865 \
        ${flags[@]+"${flags[@]}"} >"$run/script.log" 2>&1
      code=$?
      elapsed_ms=$((($(date +%s%N) - started_ns) / 1000000))
    fi
  fi
  docker logs "$CONTAINER" >"$run/container.log" 2>&1
  docker rm --force "$CONTAINER" >/dev/null 2>&1
  printf '%s\t%s\texit=%s\t%s\n' "$label" "$state" "$code" "$elapsed_ms" >>"$OUT/probe.tsv"
}

probe "real-clock-${tests[0]}" "${tests[0]}"
for test in "${tests[@]}"; do
  probe "$test" "$test" --static-time
done
echo finished >"$OUT/EXIT"
