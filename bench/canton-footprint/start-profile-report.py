"""Reads one run directory of start-profile.sh and prints where the start time
goes: CPU time by kind of JVM thread, and the share of Java execution samples
by kind of work, for the whole start and for each two seconds.

Usage: start-profile-report.py <run-dir> <samples.json>
  samples.json  output of: jfr print --json --events jdk.ExecutionSample start.jfr
"""
import collections
import datetime
import json
import pathlib
import re
import sys

BUCKET_SECONDS = 2

# A thread name maps to the first kind whose pattern matches it.
THREAD_KINDS = [
    ("JIT compiler", re.compile(r"^C[12] Compiler")),
    ("garbage collector", re.compile(r"^(GC |G1 |VM Thread|VM Periodic)")),
    ("Canton worker threads", re.compile(r"^canton-env")),
    ("main thread", re.compile(r"^(main|java)$")),
]

# A sample maps to the first kind that has a frame in its stack. The order
# puts the specific work before the general work.
SAMPLE_KINDS = [
    ("compile the startup script", ("ammonite.", "scala.tools.", "scala.reflect.internal.", "scala.reflect.io.")),
    ("load Daml packages", ("com.digitalasset.daml.lf.", "com.daml.lf.")),
    ("database setup", ("org.flywaydb.", "org.h2.", "slick.")),
    ("JSON API server", ("com.digitalasset.canton.http.", "sttp.", "io.circe.")),
    ("cryptography", ("org.bouncycastle.", "com.google.crypto.tink.", "sun.security.", "java.security.", "javax.crypto.")),
    ("read configuration", ("pureconfig.", "com.typesafe.config.")),
    ("gRPC and network", ("io.grpc.", "io.netty.")),
    ("Canton code", ("com.digitalasset.canton.",)),
]
CLASS_LOADING = ("java.lang.ClassLoader", "jdk.internal.loader.", "java.net.URLClassLoader",
                 "java.lang.invoke.", "java.util.zip.", "java.util.jar.", "jdk.internal.misc.Unsafe.ensureClassInitialized")


def thread_report(run_dir):
    seconds = collections.Counter()
    for line in (run_dir / "threads.tsv").read_text().splitlines():
        name, _, nanos = line.rpartition("\t")
        kind = next((kind for kind, pattern in THREAD_KINDS if pattern.search(name)), "other threads")
        seconds[kind] += int(nanos) / 1e9
    total = sum(seconds.values())
    print(f"CPU time until the ready line: {total:.1f} s")
    for kind, value in seconds.most_common():
        print(f"  {value:6.1f} s  {100 * value / total:3.0f}%  {kind}")


def sample_kind(frames):
    names = [frame["method"]["type"]["name"] + "." + frame["method"]["name"] for frame in frames]
    if any(name.startswith(CLASS_LOADING) for name in names[:6]):
        return "load and link classes"
    for kind, prefixes in SAMPLE_KINDS:
        if any(name.startswith(prefixes) for name in names):
            return kind
    return "other"


def sample_report(samples_path):
    events = json.loads(pathlib.Path(samples_path).read_text())["recording"]["events"]
    stamped = []
    for event in events:
        values = event["values"]
        frames = (values.get("stackTrace") or {}).get("frames") or []
        when = datetime.datetime.fromisoformat(values["startTime"])
        stamped.append((when, sample_kind(frames)))
    stamped.sort()
    first = stamped[0][0]
    total = collections.Counter(kind for _, kind in stamped)
    print(f"Java execution samples: {len(stamped)}")
    for kind, count in total.most_common():
        print(f"  {100 * count / len(stamped):3.0f}%  {kind}")
    print(f"Largest kind of work in each {BUCKET_SECONDS} s after the first sample:")
    buckets = collections.defaultdict(collections.Counter)
    for when, kind in stamped:
        buckets[int((when - first).total_seconds() // BUCKET_SECONDS)][kind] += 1
    for bucket in sorted(buckets):
        top = ", ".join(f"{kind} {count}" for kind, count in buckets[bucket].most_common(3))
        print(f"  {bucket * BUCKET_SECONDS:3d} s  {top}")


if __name__ == "__main__":
    thread_report(pathlib.Path(sys.argv[1]))
    sample_report(sys.argv[2])
