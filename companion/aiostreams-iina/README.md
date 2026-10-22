# AIO-IINA Companion for Trakt Scrobbler Plus

**One GitHub repository; two distinct, independently versioned Mac components.** The existing root IINA Trakt+ plugin (stable `v0.2.8`) continues scrobbling to Trakt. This `companion/aiostreams-iina/` folder holds the existing **AIOIINABridge.app v0.5.1** launcher that opens AIOStreams external-player URLs in official IINA 1.5.0 and handles external subtitle selection, video title and resume.

This is a source-code migration into the Trakt+ repository. It is **not** a combined executable, a second IINA plugin, a Docker service, a changed AIOStreams image, nor a deployed update. No HomeDocker changes are needed.

## Components

| Component | Own version | Distribution | Responsibility |
| --- | --- | --- | --- |
| Trakt Scrobbler Plus | Root `Info.json` v0.2.8 | `.iinaplgz` | IINA → Trakt History and scrobbles |
| AIO-IINA Companion | `bridge.py` v0.5.1 | `AIOIINABridge.app` ZIP (beta package) | AIOStreams link → IINA playback, subtitles, resume |
| v0.6 x-callback (design only) | Not deployed | Future opt-in companion + listener | IINA terminal playback → AIOStreams Web/Desktop |

Independent component versioning avoids needlessly bumping Trakt+ plugin `ghVersion` for a launcher-only update. A future approved release may attach **both artifacts to one GitHub Release** with clear component names; the current stable Trakt+ release workflow stays untouched until that migration is validated.

## Source and build

- `bridge.py`: exact previously shared **v0.5.1 source**. In this version, the original playback URL is not rewritten with `#aios_title`; title is passed safely via `--mpv-force-media-title`. Do not replace it with v0.5.0 source.
- `AIOIINABridge.applescript`: tiny macOS custom-URL handler.
- `launcher.sh`: locates system/Homebrew Python when launched from Finder.
- `scripts/build-macos.sh`: macOS-only packaging; refuses to overwrite an existing build destination and never installs/starts the app.

From a Mac checkout:

```bash
python3 companion/aiostreams-iina/bridge.py --self-test
bash companion/aiostreams-iina/scripts/build-macos.sh "$PWD/.build/aio-iina-beta"
```

The build generates `AIOIINABridge-v0.5.1-beta-monorepo.zip`; it is **ad-hoc signed, not notarized**, and has not been validated on the user's Mac. It is a **beta build artifact**, not a replacement for a working v0.5.1 app. Do not install over the existing app before canary checks.

The beta GitHub Actions workflow `companion-beta.yml` executes the self-test and macOS packaging and uploads an Actions artifact. It **never publishes a GitHub Release** or changes Trakt+ auto-updates.

## AIOStreams Custom Link (existing, stable)

```text
aios-iina://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}
```

Existing `{returnUrl}` `context` is used by v0.5.1 for same-origin PlaybackInfo/subtitles. **It does not yet send an x-callback when IINA stops.** Keep original playback links functional. `{subtitles}` creates repeat query parameters; AIOStreams substitutes them safely.

For future x-callback/position/EOF logic, see [the v0.6 design gate](../../docs/proposals/aio-iina-xcallback-v0.6.md). The IINA observer may use Trakt+'s existing playback lifecycle but **must not create a second Trakt writer**; the companion itself will never scrobble to Trakt.

## Delivery invariants

- Official IINA only, no IINA source fork or alternate build.
- No modification to AIOStreams, HomeDocker's Trakt Bridge, or other macOS plugins.
- Keep signed stream and subtitle URLs out of logs and release artifacts.
- Do not auto-mark Watched from a manual stop; suppress any possible AIO → Bridge → Trakt duplicate echo before enabling EOF callback.
- A failure of the companion should never prevent IINA/Trakt+ from playing an ordinary link.
- Keep installed v0.5.1 and Trakt+ v0.2.8 available for rollback.
