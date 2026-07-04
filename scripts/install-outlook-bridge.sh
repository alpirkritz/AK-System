#!/usr/bin/env bash
# Install (or reinstall) the Outlook → Google Dragontail bridge as a launchd agent.
# Runs the bridge every 15 minutes while this Mac is awake.
#
#   bash scripts/install-outlook-bridge.sh            # install + load
#   bash scripts/install-outlook-bridge.sh --uninstall # unload + remove
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LABEL="com.ak.outlook-bridge"
TEMPLATE="$ROOT_DIR/deploy/launchd/${LABEL}.plist"
AGENTS_DIR="$HOME/Library/LaunchAgents"
TARGET="$AGENTS_DIR/${LABEL}.plist"
RUN_SCRIPT="$ROOT_DIR/scripts/outlook-bridge-run.sh"
LOG_FILE="$ROOT_DIR/.cursor/outlook-bridge.log"

if [ "$(uname)" != "Darwin" ]; then
  echo "✗  The Outlook bridge only runs on macOS."
  exit 1
fi

uninstall() {
  launchctl unload "$TARGET" 2>/dev/null || true
  rm -f "$TARGET"
  echo "✓  Uninstalled ${LABEL}."
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
  exit 0
fi

[ -f "$TEMPLATE" ] || { echo "✗  Missing template $TEMPLATE"; exit 1; }
[ -f "$RUN_SCRIPT" ] || { echo "✗  Missing runner $RUN_SCRIPT"; exit 1; }
chmod +x "$RUN_SCRIPT"
mkdir -p "$AGENTS_DIR" "$(dirname "$LOG_FILE")"

# Substitute absolute paths (use a delimiter unlikely to appear in paths).
sed \
  -e "s|__RUN_SCRIPT__|${RUN_SCRIPT}|g" \
  -e "s|__WORKDIR__|${ROOT_DIR}|g" \
  -e "s|__LOG__|${LOG_FILE}|g" \
  "$TEMPLATE" > "$TARGET"

launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "✓  Installed and loaded ${LABEL}."
echo "   Runner: $RUN_SCRIPT"
echo "   Log:    $LOG_FILE"
echo "   Runs every 900s while the Mac is awake (RunAtLoad triggers one now)."
echo "   Status: launchctl list | grep ${LABEL}"
echo "   Stop:   bash scripts/install-outlook-bridge.sh --uninstall"
