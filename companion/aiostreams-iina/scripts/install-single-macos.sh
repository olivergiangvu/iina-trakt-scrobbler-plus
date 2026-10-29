#!/bin/bash
# Install exactly one AIO-IINA Companion from this Git checkout.
# Build/test first; replace local apps only after signed app is verified.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(uname -s)" = "Darwin" ] || { echo "ERROR: macOS required" >&2; exit 2; }

TARGET="$HOME/Applications/AIOIINABridge.app"
OLD_USER="$HOME/Applications/AIOIINABridge-beta.app"
OLD_SYSTEM="/Applications/AIOIINABridge-beta.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aio-iina-single.XXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "===== SOURCE & REGRESSION ====="
git -C "$ROOT" rev-parse --short HEAD || true
(
  cd "$ROOT"
  python3 bridge.py --self-test
  python3 test_identity_context.py
  python3 -m unittest discover -s tests -p 'test_*.py' -v
)
bash "$ROOT/scripts/build-macos.sh" "$TMP/build"
NEW="$TMP/build/AIOIINABridge.app"
[ -d "$NEW" ] || { echo "ERROR: build missing" >&2; exit 3; }
codesign --verify --deep --strict --verbose=2 "$NEW"
PLIST="$NEW/Contents/Info.plist"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")" = "io.github.olivergiangvu.AIOIINABridge" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")" = "0.7.1" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$PLIST")" = "aios-iina" ]
echo "PASS: signed 0.7.1 single-app build and tests"

# Request permission before making any changes to installed apps.
if [ -e "$OLD_SYSTEM" ]; then sudo -v; fi
mkdir -p "$HOME/Applications"

echo "===== REPLACE INSTALLED BRIDGE APPS ====="
for old in "$TARGET" "$OLD_USER" "$OLD_SYSTEM"; do
  if [ -e "$old" ]; then "$LSREG" -u "$old" || true; fi
done
rm -rf "$TARGET" "$OLD_USER"
if [ -e "$OLD_SYSTEM" ]; then sudo rm -rf "$OLD_SYSTEM"; fi
/usr/bin/ditto "$NEW" "$TARGET"
"$LSREG" -f "$TARGET"
codesign --verify --deep --strict "$TARGET"

echo "===== INSTALLED ====="
echo "$TARGET"
echo "Version: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET/Contents/Info.plist")"
echo "URL scheme: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$TARGET/Contents/Info.plist")"
echo "Existing AIO-IINA configs, logs and Keychain are untouched."
echo "AIO-IINA Companion: one active app."
