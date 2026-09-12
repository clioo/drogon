#!/bin/sh
# Homebrew cask uninstall hook. The Drogon daemon is deliberately detached,
# so quitting Electron does not stop it. Match only the daemon executable that
# belongs to this bundle and re-check its command line before escalation; no
# broad process-name kill is safe here.
set -eu

bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
daemon="$bin_dir/drogond"

process_command() {
  /bin/ps -p "$1" -o command= 2>/dev/null | /usr/bin/sed -e 's/^[[:space:]]*//' || true
}

is_target() {
  case "$(process_command "$1")" in
    "$daemon --data-dir "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Keep the exact executable path and the --data-dir boundary in the match.
# The command line is only used to identify a process; the PID is revalidated
# immediately before each signal to avoid acting on a reused PID.
pids=$(
  /bin/ps -axo pid=,command= |
    /usr/bin/awk -v daemon="$daemon" '
      {
        pid = $1;
        $1 = "";
        sub(/^[[:space:]]+/, "", $0);
        if (index($0, daemon " --data-dir ") == 1) print pid;
      }'
)

for pid in $pids; do
  case "$pid" in
    ''|*[!0-9]*) continue ;;
  esac
  [ "$pid" -ne "$$" ] || continue
  is_target "$pid" || continue
  kill -TERM "$pid" 2>/dev/null || continue

  deadline=$(( $(/bin/date +%s) + 8 ))
  while is_target "$pid" && [ "$(/bin/date +%s)" -lt "$deadline" ]; do
    /bin/sleep 0.2
  done
  if is_target "$pid"; then
    # Re-check the exact command line after the grace period. This is the
    # only forceful path and remains scoped to the original Drogon binary.
    kill -KILL "$pid" 2>/dev/null || true
    deadline=$(( $(/bin/date +%s) + 2 ))
    while is_target "$pid" && [ "$(/bin/date +%s)" -lt "$deadline" ]; do
      /bin/sleep 0.2
    done
  fi
  if is_target "$pid"; then
    echo "Drogon daemon pid $pid did not exit" >&2
    exit 1
  fi
done
