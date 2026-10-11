#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BUILD_DIR="$ROOT_DIR/.build/iina-trakt-scrobbler.iinaplugin"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp "$ROOT_DIR/Info.json" "$BUILD_DIR/Info.json"
cp "$ROOT_DIR/main.js" "$BUILD_DIR/main.js"
cp "$ROOT_DIR/stream-source.js" "$BUILD_DIR/stream-source.js"
cp "$ROOT_DIR/playback-identity.js" "$BUILD_DIR/playback-identity.js"
cp "$ROOT_DIR/mediafusion-identity.js" "$BUILD_DIR/mediafusion-identity.js"
cp "$ROOT_DIR/playback-diagnostics.js" "$BUILD_DIR/playback-diagnostics.js"
cp "$ROOT_DIR/stop-journal.js" "$BUILD_DIR/stop-journal.js"
cp "$ROOT_DIR/sync-history.js" "$BUILD_DIR/sync-history.js"
cp "$ROOT_DIR/trakt-api-gate.js" "$BUILD_DIR/trakt-api-gate.js"
cp "$ROOT_DIR/monitor.js" "$BUILD_DIR/monitor.js"
cp "$ROOT_DIR/parser.iina.js" "$BUILD_DIR/parser.iina.js"
cp "$ROOT_DIR/trakt.js" "$BUILD_DIR/trakt.js"
cp "$ROOT_DIR/trakt_keys.js" "$BUILD_DIR/trakt_keys.js"
cp "$ROOT_DIR/preferences.html" "$BUILD_DIR/preferences.html"
cp "$ROOT_DIR/sidebar.html" "$BUILD_DIR/sidebar.html"
cp -R "$ROOT_DIR/assets" "$BUILD_DIR/assets"

printf '%s\n' "$BUILD_DIR"
