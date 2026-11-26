#!/usr/bin/env python3
"""Splits LocalNet starts into stages, from the compose logs that localnet.sh keeps.

Usage: localnet-stages.py <compose.log>...
Prints one row of seconds for each log, then the median of each stage.
Environment: VALIDATORS, the number of validator apps in the logs (default 3).
A LocalNet with no nginx container has no "wait for probe" stage: that column is NA.

The first log line of a container marks the moment Docker started it, and
Docker starts canton, splice and nginx one after the other, each when the
container before it reports healthy. The stages inside the splice container
come from the log lines of the Splice apps. A log can also hold a restart: each
stage ends at the first line that matches, so the stages are those of the first start.
"""
import datetime
import os
import re
import statistics
import sys

LINE = re.compile(r"^(\S+)\s+\| (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6})")
# The first log line of the splice container that contains the text ends the stage.
SPLICE_STAGES = [
    ("start apps, set identities", "sv app initialization: Ensure participant is initialized with expected id finished"),
    ("decode packages", "sv app initialization: Get participant ID started"),
    ("create synchronizer", "Ensuring that SV1 has uploaded the initial set of packages"),
    ("upload packages", "Success: SV1 has uploaded the initial set of packages"),
    ("create network rules", "sv app initialization: Initialization complete"),
]
VALIDATOR_READY = re.compile(r"validator_backend app initialization: Initialize app finished")
VALIDATORS = int(os.environ.get("VALIDATORS", "3"))
STAGES = ["postgres", "canton"] + [name for name, _ in SPLICE_STAGES] + ["onboard validators", "wait for probe"]


def stages_of(path):
    first = {}
    ends = []
    validators_ready = []
    for raw in open(path, errors="replace"):
        match = LINE.match(raw)
        if not match:
            continue
        container = match.group(1)
        when = datetime.datetime.fromisoformat(match.group(2))
        first.setdefault(container, when)
        if container != "splice":
            continue
        if len(ends) < len(SPLICE_STAGES) and SPLICE_STAGES[len(ends)][1] in raw:
            ends.append(when)
        elif len(validators_ready) < VALIDATORS and VALIDATOR_READY.search(raw):
            validators_ready.append(when)
    # Some stage lines are DEBUG lines, so a LocalNet that logs at INFO has no stages to read.
    if len(ends) < len(SPLICE_STAGES):
        raise SystemExit(f"{path}: no log line for the end of '{SPLICE_STAGES[len(ends)][0]}'")
    if len(validators_ready) < VALIDATORS:
        raise SystemExit(f"{path}: {len(validators_ready)} of {VALIDATORS} validators logged that they are ready")
    marks = [first["postgres"], first["canton"], first["splice"]] + ends + [validators_ready[-1]]
    seconds = [(later - earlier).total_seconds() for earlier, later in zip(marks, marks[1:])]
    # Docker starts nginx when the splice container reports healthy.
    probe = (first["nginx"] - validators_ready[-1]).total_seconds() if "nginx" in first else None
    return seconds + [probe]


def main():
    rows = [stages_of(path) for path in sys.argv[1:]]
    print("\t".join(["run"] + STAGES + ["sum"]))
    for path, row in zip(sys.argv[1:], rows):
        print("\t".join([path.split("/")[-2]] + [cell(value) for value in row] + [cell(total(row))]))
    medians = [median(column) for column in zip(*rows)]
    print("\t".join(["median"] + [cell(value) for value in medians] + [cell(total(medians))]))


def cell(value):
    return "NA" if value is None else f"{value:.0f}"


def total(row):
    return sum(value for value in row if value is not None)


def median(column):
    present = [value for value in column if value is not None]
    return statistics.median(present) if present else None


if __name__ == "__main__":
    main()
