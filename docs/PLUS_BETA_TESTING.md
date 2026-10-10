# Trakt Scrobbler Plus — v0.2.0-beta.1 test instructions

## Which computer?
- **MAC Terminal only:** every command in this guide. Run these on the Mac that has IINA installed.
- **HomeDocker / Terminus / SSH:** no commands needed. Remux server configuration remains unchanged.
- **GitHub in browser:** review the feature branch and PR.

## 1. Prerequisites — Mac Terminal
```bash
git --version
node --version
test -x /Applications/IINA.app/Contents/MacOS/iina-plugin && echo "IINA CLI: OK"
```
Node is used for unit tests; IINA 1.4+ is used to package and install the plugin.

## 2. Clone the test branch — Mac Terminal
```bash
cd ~/Downloads
git clone --branch feature/remux-stream-identity-v1 --single-branch https://github.com/olivergiangvu/iina-trakt-scrobbler-plus.git
cd iina-trakt-scrobbler-plus
```

## 3. Run tests — Mac Terminal
```bash
node tests/stream-source.js
node tests/parser-smoke.js
node tests/trakt-resolution.js
```
All three tests should print a PASS message. Stop and report failures before packaging.

## 4. Pack — Mac Terminal
```bash
chmod +x scripts/stage-plugin.sh scripts/pack-release.sh
./scripts/pack-release.sh
find .build -name '*.iinaplgz' -print
```
The package includes `stream-source.js` through `scripts/stage-plugin.sh`.

## 5. Install in IINA — Mac
Double-click the generated `.iinaplgz` in Finder (inside the `.build` folder), or run:
```bash
PACKAGE=$(find "$PWD/.build" -name '*.iinaplgz' -print -quit)
test -n "$PACKAGE" && open -a IINA "$PACKAGE"
```
If IINA shows an install confirmation, approve. Restart IINA after installation.

## 6. Prevent duplicate scrobbles
Trakt Scrobbler Plus has an independent plugin ID and Keychain entry.
**Disable scrobbling in the original Trakt plugin before enabling it in Trakt+.**
Open the Trakt+ sidebar and authorize Trakt if requested.

## 7. Verify the Remux case
Use the same Remux URL for The Legend of Vox Machina season 2 episode 4.
Expected:
- playback identifies **The Legend of Vox Machina S02E04**, not an encoded token or S01E25
- source query `torrent_name` is parsed preferentially
- `media_id=tt11247158` is used as the show identity with Trakt, if available
- episode is verified before any scrobble is sent
- cross-check live scrobble and the final watched entry on Trakt

The plugin uses the Trakt API directly for ID lookup. TMDB-based multi-source
verification and interactive season/episode editing are **planned for Phase 2**
and are not implemented in this beta.

## 8. Rollback
In IINA → Settings / Preferences → Plugins, remove **Trakt Scrobbler Plus**,
then re-enable Scrobbling in the original **Trakt Scrobbler** plugin.
The fork uses a distinct plugin ID, so it does not need to overwrite the original.

## Source credits
Based on i3p9/iina-trakt-scrobbler (GPL-3.0); stream URL recognition patterns were
informed by Zain-Imam/iina-episode-info (MIT). This beta uses independent
implementation, not a vendored copy of Episode Info.
