#!/bin/bash
#
# Build the Flutter Web application for RustDesk Web.
#
# Pipeline:
#   1. Build the TS bridge layer  → dist/bridge.js
#   2. Ensure the rustdesk submodule is initialised
#   3. Copy the flutter-web/ overlay (index.html, manifest, icons, bridge.js)
#      into vendor/rustdesk/flutter/web/
#   4. Run `flutter build web --release`
#   5. Copy the final artefact to dist/web/
#
# Usage:
#   bash scripts/build-web.sh
#
# NOTE: Flutter SDK must be on $PATH.  The GitHub Action
#       (.github/workflows/web-build.yml) installs it automatically.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/5] Building TS bridge layer (dist/bridge.js)"
cd "$REPO_ROOT"
npm run build:bridge

echo "==> [2/5] Ensuring rustdesk submodule is initialised"
git submodule update --init --recursive

echo "==> [3/5] Copying web overlay into flutter web directory"
FLUTTER_DIR="$REPO_ROOT/vendor/rustdesk/flutter"
WEB_DIR="$FLUTTER_DIR/web"
mkdir -p "$WEB_DIR/js"
cp "$REPO_ROOT/flutter-web/index.html"   "$WEB_DIR/index.html"
cp "$REPO_ROOT/flutter-web/manifest.json" "$WEB_DIR/manifest.json"
cp -r "$REPO_ROOT/flutter-web/icons/"    "$WEB_DIR/icons/" 2>/dev/null || true
cp "$REPO_ROOT/dist/bridge.js"           "$WEB_DIR/js/bridge.js"

echo "==> [4/5] Building Flutter Web (release)"
cd "$FLUTTER_DIR"
flutter pub get
flutter build web --release

echo "==> [5/5] Copying final artefact to dist/web/"
mkdir -p "$REPO_ROOT/dist/web"
cp -r "$FLUTTER_DIR/build/web/"* "$REPO_ROOT/dist/web/"

echo ""
echo "Build complete: $REPO_ROOT/dist/web/"