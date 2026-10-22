#!/bin/sh
# AIOIINABridge.app entry point (macOS). No daemon, no network listener.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
BRIDGE="$HERE/bridge.py"
[ -f "$BRIDGE" ] || exit 2

# Finder/LaunchServices does not inherit an interactive Homebrew PATH.
PYTHON=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$candidate" ]; then PYTHON="$candidate"; break; fi
done
[ -n "$PYTHON" ] || exit 127
[ "$#" -eq 1 ] || exit 64
exec "$PYTHON" "$BRIDGE" --handle-url "$1"
