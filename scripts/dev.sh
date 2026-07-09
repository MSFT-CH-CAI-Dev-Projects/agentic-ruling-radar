#!/usr/bin/env bash
# Start the web dev server with logs piped to /tmp/ruling-radar-web.log so the
# agent can tail them via 'bash scripts/diag.sh web' without asking the
# user for output.
#
# Usage:
#   bash scripts/dev.sh start   # start in background, pid -> /tmp/ruling-radar-web.pid
#   bash scripts/dev.sh stop    # kill the background process
#   bash scripts/dev.sh tail    # tail -f /tmp/ruling-radar-web.log
#   bash scripts/dev.sh status  # show status

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/tmp/ruling-radar-web.log
PIDFILE=/tmp/ruling-radar-web.pid

case "${1:-status}" in
  start)
    if [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE")), logs at $LOG"
      exit 0
    fi
    : > "$LOG"
    ( cd "$REPO_ROOT/apps/web" && nohup pnpm dev >> "$LOG" 2>&1 & echo $! > "$PIDFILE" )
    sleep 2
    echo "started pid=$(cat "$PIDFILE") · logs=$LOG"
    ;;
  stop)
    stopped_any=0
    if [[ -f $PIDFILE ]]; then
      pid=$(cat "$PIDFILE")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "stopped tracked pid=$pid" && stopped_any=1
      fi
      rm -f "$PIDFILE"
    fi
    # Belt-and-braces: also catch orphan next dev / pnpm dev / next-server
    # processes for this repo (e.g. left over after a crashed session).
    # We grep on cwd + cmdline; only pids whose /proc/<pid>/cwd resolves
    # into REPO_ROOT are killed, so this never touches other projects.
    for pid in $(pgrep -f 'next dev|next-server|pnpm.*dev' 2>/dev/null); do
      cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo "")
      if [[ "$cwd" == "$REPO_ROOT"* ]]; then
        kill "$pid" 2>/dev/null && echo "stopped orphan pid=$pid ($cwd)" && stopped_any=1
      fi
    done
    if [[ $stopped_any -eq 0 ]]; then
      echo "nothing to stop"
    fi
    ;;
  tail)
    [[ -f $LOG ]] && tail -f "$LOG" || echo "no log file"
    ;;
  status)
    if [[ -f $PIDFILE ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running pid=$(cat "$PIDFILE") · log=$LOG"
    else
      echo "stopped"
    fi
    ;;
  *)
    echo "usage: $0 [start|stop|tail|status]" >&2
    exit 2
    ;;
esac
