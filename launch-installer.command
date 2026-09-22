#!/usr/bin/env bash
# launch-installer.command
#
# This file is intentionally committed to git and kept executable so that macOS
# Gatekeeper/quarantine does not strip the exec bit on clone/checkout. It is a
# thin, double-clickable launcher: it just starts installer/server.py (a Python3
# stdlib HTTP server) and opens the local GUI in the default browser. Closing the
# Terminal window or pressing Ctrl-C stops the server via the EXIT/INT/TERM trap.

set -euo pipefail

# Resolve this script's own directory even when double-clicked from Finder or
# invoked via a symlink, then cd there so installer/server.py resolves relatively.
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
DIR=$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)
cd "$DIR"

# Finder-launched shells often inherit no locale; an unset locale is a known
# cause of Python/tty glitches, so pin UTF-8 explicitly.
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

SERVER="installer/server.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found on PATH. Install Python 3 and try again." >&2
  exit 1
fi

if [ ! -f "$SERVER" ]; then
  echo "ERROR: could not find $SERVER" >&2
  echo "Looked in: $DIR/$SERVER" >&2
  exit 1
fi

# Probe a TCP port on 127.0.0.1 using bash /dev/tcp; returns 0 if something is
# already listening (port in use), non-zero if the port is free.
port_in_use() {
  local p=$1
  (exec 3<>"/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1 && { exec 3>&- 3<&-; return 0; }
  return 1
}

# Honor INSTALLER_PORT if set, else default 8765; increment past in-use ports.
PORT=${INSTALLER_PORT:-8765}
tries=0
while port_in_use "$PORT"; do
  tries=$((tries + 1))
  if [ "$tries" -ge 20 ]; then
    echo "ERROR: no free port found near $PORT after 20 tries." >&2
    exit 1
  fi
  PORT=$((PORT + 1))
done
export INSTALLER_PORT="$PORT"

# Start the server in the background and ensure it is killed on exit so no
# orphaned server lingers after the window closes or Ctrl-C is pressed.
python3 "$SERVER" &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Poll up to ~5s until the server is actually listening before opening the
# browser; opening too early yields the blank-panel symptom.
ready=0
for _ in $(seq 1 50); do
  if port_in_use "$PORT"; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: server did not start listening on port $PORT within 5s." >&2
  exit 1
fi

URL="http://127.0.0.1:$PORT/"

echo "======================================================"
echo "  Opus/Sonnet Orchestrator - Installer"
echo "------------------------------------------------------"
echo "  Server:  $SERVER (pid $SERVER_PID)"
echo "  URL:     $URL"
echo "------------------------------------------------------"
echo "  Close this window or press Ctrl-C to stop the installer."
echo "======================================================"

open "$URL"

# Stay attached to the server so the Terminal window stays alive and the trap
# fires when the window closes or Ctrl-C is pressed.
wait "$SERVER_PID"
