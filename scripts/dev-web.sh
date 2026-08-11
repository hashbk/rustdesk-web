#!/bin/bash
#
# Dev workflow for RustDesk Web.
#
# Starts the Vite dev server for the TS bridge layer (hot-reload) and prints
# instructions for running the Flutter app on a separate port.
#
# Usage:
#   bash scripts/dev-web.sh
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting bridge dev server (Vite)..."
cd "$REPO_ROOT"
npm run dev &
VITE_PID=$!

echo ""
echo "──────────────────────────────────────────────────────────"
echo " In another terminal, run:"
echo "   cd vendor/rustdesk/flutter && flutter run -d web --web-port=8080"
echo "   (bridge.js available at http://localhost:5173/bridge.js)"
echo "──────────────────────────────────────────────────────────"
echo ""

trap "kill $VITE_PID 2>/dev/null || true" EXIT
wait $VITE_PID