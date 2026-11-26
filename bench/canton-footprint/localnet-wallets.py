#!/usr/bin/env python3
"""Registers more wallet users on a running LocalNet, in steps, and measures
LocalNet after each step.

A wallet user registers itself on a validator, which allocates a party for it
and starts the wallet automation of that party. Each new user then takes
Canton Coin from the faucet, and the script checks its balance. Half of the
users register on the app-user validator and half on the app-provider
validator.

Usage: localnet-wallets.py <localnet-dir> <target>...
  localnet-dir  the cluster/compose/localnet directory of the Splice release
  target        totals of new wallet users, in rising order

Prints one tab-separated row for the network before the first user, and one
after each step:
  wallets, onboard_ms, median_ms, slowest_ms, canton_heap_mib, splice_heap_mib,
  containers_mib, postgres_mib, idle_cores, state
onboard_ms is the time for the new users of the step. The heaps are measured
after a forced collection. containers_mib is the memory of all containers
before those collections. idle_cores is the CPU that all containers used in a
window after the step, in cores.
Exits with 0 only when every user registered and has its Canton Coin.

Environment:
  LOCALNET_PROJECT  the compose project (default canton-bench-localnet)
"""
import os
import pathlib
import statistics
import subprocess
import sys
import time
from decimal import Decimal

from localnet_wallet import wallet

ROLES = ("app-user", "app-provider")
JVM_CONTAINERS = ("canton", "splice")
FAUCET_AMOUNT = Decimal("10.0")
# A holding loses a small fee in each round.
HOLDING_FEE_ALLOWANCE = Decimal("0.01")
IDLE_WINDOW_S = 30
MIB = 1024 * 1024


def docker(*arguments):
    return subprocess.run(["docker", *arguments], check=True, capture_output=True, text=True).stdout


def containers():
    project = os.environ.get("LOCALNET_PROJECT", "canton-bench-localnet")
    return docker("ps", "--filter", f"label=com.docker.compose.project={project}", "--format", "{{.Names}}").split()


def memory_mib(container):
    return int(docker("exec", container, "cat", "/sys/fs/cgroup/memory.current")) // MIB


def cpu_seconds(names):
    total_usec = 0
    for name in names:
        for line in docker("exec", name, "cat", "/sys/fs/cgroup/cpu.stat").splitlines():
            key, value = line.split()
            if key == "usage_usec":
                total_usec += int(value)
    return total_usec / 1_000_000


def live_heap_mib(container):
    """The heap of the container's JVM after a forced collection."""
    report = docker("exec", container, "sh", "-c",
                    'pid=$(pgrep -o java) && jcmd "$pid" GC.run >/dev/null && jcmd "$pid" GC.heap_info')
    used_kib = 0
    for line in report.splitlines():
        if "Metaspace" in line:
            break
        words = line.replace(",", " ").split()
        if "used" in words:
            used_kib += int(words[words.index("used") + 1].rstrip("K"))
    return used_kib // 1024


def measure():
    names = containers()
    cpu_before = cpu_seconds(names)
    time.sleep(IDLE_WINDOW_S)  # the window that idle_cores covers
    idle_cores = (cpu_seconds(names) - cpu_before) / IDLE_WINDOW_S
    containers_mib = sum(memory_mib(name) for name in names)
    postgres_mib = memory_mib("postgres")
    heaps = [live_heap_mib(name) for name in JVM_CONTAINERS]
    return [*heaps, containers_mib, postgres_mib, f"{idle_cores:.2f}"]


def onboard(localnet_dir, index):
    role = ROLES[index % len(ROLES)]
    user = wallet(localnet_dir, role, f"load-wallet-{index}")
    user.party()
    user.call("POST", "/v0/wallet/tap", {"amount": str(FAUCET_AMOUNT)})
    balance = user.balance()
    if balance < FAUCET_AMOUNT - HOLDING_FEE_ALLOWANCE:
        raise SystemExit(f"{user.name}: the balance is {balance}, expected {FAUCET_AMOUNT}")


def main():
    localnet_dir = pathlib.Path(sys.argv[1])
    targets = [int(argument) for argument in sys.argv[2:]]
    print("\t".join(str(value) for value in (0, 0, 0, 0, *measure(), "ok")), flush=True)
    wallets = 0
    for target in targets:
        durations_ms = []
        state = "ok"
        started = time.monotonic()
        try:
            for index in range(wallets + 1, target + 1):
                onboard_started = time.monotonic()
                onboard(localnet_dir, index)
                durations_ms.append((time.monotonic() - onboard_started) * 1000)
        except SystemExit as failure:
            state = f"failed: {str(failure)[:200]}"
        onboard_ms = (time.monotonic() - started) * 1000
        wallets += len(durations_ms)
        median_ms = round(statistics.median(durations_ms)) if durations_ms else "NA"
        slowest_ms = round(max(durations_ms)) if durations_ms else "NA"
        print("\t".join(str(value) for value in (
            wallets, round(onboard_ms), median_ms, slowest_ms, *measure(), state)), flush=True)
        if state != "ok":
            raise SystemExit(1)


if __name__ == "__main__":
    main()
