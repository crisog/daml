"""Measures the cost of fsync on the files of a directory, as Postgres does
at crash recovery: it opens each file of its data directory and calls fsync.
Usage: fsync-cost.py <directory> <files>"""
import os, shutil, sys, time

directory, count = sys.argv[1], int(sys.argv[2])
os.makedirs(directory)
paths = [f"{directory}/file-{index}" for index in range(count)]
for path in paths:
    with open(path, "wb") as handle:
        handle.write(b"x" * 8192)

def sync_all():
    started = time.monotonic()
    for path in paths:
        descriptor = os.open(path, os.O_RDONLY)
        os.fsync(descriptor)
        os.close(descriptor)
    return (time.monotonic() - started) * 1000 / count

print(f"{count} new files of 8 KiB: {sync_all():.3f} ms for each fsync")
print(f"the same files again:    {sync_all():.3f} ms for each fsync")
shutil.rmtree(directory)
