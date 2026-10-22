#!/bin/bash
# Build a stand-alone beta .app from the v0.5.1 baseline (no install or release).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
APP="$OUT/AIOIINABridge-beta.app"
PLIST="$APP/Contents/Info.plist"
for tool in osacompile /usr/libexec/PlistBuddy ditto python3 codesign; do
  command -v "$tool" >/dev/null || { echo "Missing macOS build tool: $tool" >&2; exit 2; }
done
[ "$(uname -s)" = "Darwin" ] || { echo "Mac only" >&2; exit 2; }
[ ! -e "$APP" ] || { echo "Refusing to overwrite $APP" >&2; exit 3; }
mkdir -p "$OUT"
python3 "$ROOT/bridge.py" --self-test
osacompile -o "$APP" "$ROOT/AIOIINABridge.applescript"
mkdir -p "$APP/Contents/Resources"
cp "$ROOT/bridge.py" "$APP/Contents/Resources/bridge.py"
cp "$ROOT/callback_session.py" "$APP/Contents/Resources/callback_session.py"
cp "$ROOT/launcher.sh" "$APP/Contents/Resources/launcher.sh"
chmod 755 "$APP/Contents/Resources/launcher.sh"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.olivergiangvu.AIOIINABridge.beta" "$PLIST" ||
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string io.github.olivergiangvu.AIOIINABridge.beta" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 0.6.0" "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 0.6.0" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 60" "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion 60" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string io.github.olivergiangvu.aios-iina" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string aios-iina-beta" "$PLIST"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/AIOIINABridge-v0.6.0-beta.1.zip"
echo "BUILD_OK: $OUT/AIOIINABridge-v0.6.0-beta.1.zip"
echo "NOT_INSTALLED; ad-hoc signed only, not notarized. Test on Mac before deployment."
