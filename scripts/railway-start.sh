#!/usr/bin/env bash
# Legacy Railway start — kept for backward compatibility.
# The canonical production entrypoint is scripts/production-start.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/production-start.sh"
