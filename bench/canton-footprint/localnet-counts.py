"""Counts what the Splice apps start in one LocalNet start, from compose.log.
Usage: splice-counts.py <compose.log>"""
import collections, json, re, sys

LINE = re.compile(r"^splice\s+\| \S+ (\{.*)$")
uploads = collections.Counter()
triggers = collections.defaultdict(set)
apps = set()
for raw in open(sys.argv[1], errors="replace"):
    match = LINE.match(raw)
    if not match:
        continue
    try:
        record = json.loads(match.group(1))
    except ValueError:
        continue
    message = record.get("message", "")
    logger = record.get("logger_name", "")
    name, _, app = logger.partition(":")
    if " app initialization: Starting initialization" in message:
        apps.add(message.split(" app initialization")[0])
    if "PackageService/UploadDar" in message and "sending request" in message:
        target = re.search(r"to (\S+):", message)
        uploads[target.group(1) if target else "?"] += 1
    if name.split(".")[-1].endswith("Trigger"):
        triggers[app].add(name.split(".")[-1])
print("apps:", len(apps), sorted(apps))
print("package uploads:", sum(uploads.values()), dict(sorted(uploads.items())))
print("triggers that logged:", sum(len(v) for v in triggers.values()))
for app, names in sorted(triggers.items()):
    print(f"  {app.split('::')[0]}\t{len(names)}")
