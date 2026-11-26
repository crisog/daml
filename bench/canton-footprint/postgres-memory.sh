#!/usr/bin/env bash
# Shows what the memory of LocalNet's Postgres container consists of.
#
# Usage: postgres-memory.sh report <label>
#          One reading: the container's own split of its memory (process
#          memory, file cache, shared memory, kernel), the server's settings
#          and connections, the size of its databases, and the memory of its
#          processes.
#        postgres-memory.sh sample <seconds> <interval-seconds>
#          One tab-separated row at each interval: epoch seconds, then the
#          MiB of memory.current, anon, file, shmem and kernel. A row has
#          "NA" when the container does not run yet.
#
# The container counts file cache as its memory. The kernel gives that cache
# back when a process needs the memory, so "anon" and "shmem" are the memory
# that Postgres itself holds.
set -uo pipefail

readonly CONTAINER=postgres
readonly MIB=1048576

cgroup() { docker exec "$CONTAINER" cat "/sys/fs/cgroup/$1" 2>/dev/null; }
stat_mib() { # stat_mib <stat-text> <key>
  awk -v key="$2" -v mib="$MIB" '$1 == key { print int($2 / mib) }' <<<"$1"
}
query() { # query <sql>
  docker exec --env SQL="$1" "$CONTAINER" \
    sh -c 'psql --username "$POSTGRES_USER" --dbname postgres --no-align --tuples-only --field-separator " " --command "$SQL"'
}

report() {
  local label=$1 stat
  stat=$(cgroup memory.stat) || { echo "the postgres container does not run" >&2; return 1; }
  echo "== $label, $(date --utc +%H:%M:%SZ)"
  echo "container memory, MiB"
  echo "  current        $(($(cgroup memory.current) / MIB))"
  echo "  peak           $(($(cgroup memory.peak) / MIB))"
  echo "  anon           $(stat_mib "$stat" anon)    (private memory of the processes)"
  echo "  shmem          $(stat_mib "$stat" shmem)    (shared memory, such as shared_buffers)"
  echo "  file           $(stat_mib "$stat" file)    (file cache; includes shmem)"
  echo "  kernel         $(stat_mib "$stat" kernel)    (page tables, kernel stacks, slab)"
  echo "  pagetables     $(stat_mib "$stat" pagetables)"
  echo "settings"
  query "select name || ' = ' || setting || coalesce(' ' || unit, '') from pg_settings
         where name in ('max_connections', 'shared_buffers', 'work_mem', 'maintenance_work_mem') order by name" | sed 's/^/  /'
  echo "connections"
  echo "  total          $(query "select count(*) from pg_stat_activity where backend_type = 'client backend'")"
  echo "  by state       $(query "select state || ':' || count(*) from pg_stat_activity
                                  where backend_type = 'client backend' group by state order by count(*) desc" | tr '\n' ' ')"
  echo "  by database    $(query "select datname || ':' || count(*) from pg_stat_activity
                                  where backend_type = 'client backend' group by datname order by count(*) desc" | tr '\n' ' ')"
  echo "databases"
  echo "  count          $(query "select count(*) from pg_database where not datistemplate")"
  echo "  size, MiB      $(query "select sum(pg_database_size(datname)) / $MIB from pg_database" | cut -d. -f1)"
  echo "processes (from /proc/<pid>/smaps_rollup inside the container)"
  # One line for each process: private memory in kB and the command line.
  docker exec "$CONTAINER" sh -c '
    for dir in /proc/[0-9]*; do
      [ -r "$dir/smaps_rollup" ] || continue
      anon=$(awk "/^Pss_Anon:/ { print \$2 }" "$dir/smaps_rollup")
      shm=$(awk "/^Pss_Shmem:/ { print \$2 }" "$dir/smaps_rollup")
      printf "%s\t%s\t%s\n" "${anon:-0}" "${shm:-0}" "$(tr "\0" " " <"$dir/cmdline" | cut -c1-60)"
    done' | awk -F'\t' -v kb=1024 '
      { anon += $1; shm += $2; count += 1
        if ($3 ~ /^postgres: .* (idle|active|idle in transaction)/ || $3 ~ /\([0-9]+\)/) { backends += 1; backend_anon += $1; if ($1 > largest) largest = $1 } }
      END {
        printf "  count          %d\n", count
        printf "  private, MiB   %d   (sum of Pss_Anon)\n", anon / kb
        printf "  shared, MiB    %d   (sum of Pss_Shmem)\n", shm / kb
        printf "  backends       %d, %.1f MiB of private memory each on average, %.1f MiB the largest\n",
          backends, (backends ? backend_anon / backends / kb : 0), largest / kb
      }'
}

sample() {
  local seconds=$1 interval=$2 deadline stat
  deadline=$((SECONDS + seconds))
  while ((SECONDS < deadline)); do
    if stat=$(cgroup memory.stat) && [[ -n "$stat" ]]; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$(($(cgroup memory.current) / MIB))" \
        "$(stat_mib "$stat" anon)" "$(stat_mib "$stat" file)" "$(stat_mib "$stat" shmem)" "$(stat_mib "$stat" kernel)"
    else
      printf '%s\tNA\tNA\tNA\tNA\tNA\n' "$(date +%s)"
    fi
    sleep "$interval"
  done
}

case "${1:-}" in
  report) report "${2:?label}" ;;
  sample) sample "${2:?seconds}" "${3:?interval}" ;;
  *) echo "usage: postgres-memory.sh report <label> | sample <seconds> <interval-seconds>" >&2; exit 2 ;;
esac
