# AIO-IINA Companion for Trakt Scrobbler Plus

**One GitHub repository; two distinct, independently versioned Mac components.** The existing root IINA Trakt+ plugin (stable `v0.2.8`) continues scrobbling to Trakt. This `companion/aiostreams-iina/` folder holds the existing **AIOIINABridge.app v0.5.1** launcher that opens AIOStreams external-player URLs in official IINA 1.5.0 and handles external subtitle selection, video title and resume.

This is a source-code migration into the Trakt+ repository. It is **not** a combined executable, a second IINA plugin, a Docker service, a changed AIOStreams image, nor a deployed update. No HomeDocker changes are needed.

## Single active macOS app — v0.7.2 candidate

GitHub source/ref is the only version history. Install **one**
`~/Applications/AIOIINABridge.app` for both beta testing and stable use,
always registered on `aios-iina://`. Do not keep a second beta app or change
the AIOStreams Custom Link to switch channels. Stable promotion changes the
Git ref/release and version, not the installed app name or URL scheme.

From the selected candidate source checkout on macOS:

```bash
bash companion/aiostreams-iina/scripts/install-single-macos.sh
```

The v0.7.2 beta also repairs the exact malformed HLS path suffix
`index.m3u8%23aios_title=...` (legacy encoded title metadata) before opening
IINA; it does not alter any other signed playback URLs or query bytes.

The installer runs all offline regressions, builds and verifies the signed app,
then unregisters/removes only the three known older Companion app bundles and
installs the new single app. A build or test failure leaves existing installs
untouched. It does not delete Trakt+ / Episode Info+, user preferences, logs,
callback descriptors, or Keychain credentials. This is still a **beta candidate**
until live identity API verification and Trakt+/EP+ consumer integration pass.

The historical side-by-side beta instructions below document earlier v0.6/v0.7
canary releases; they are no longer the active deployment policy.

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

The build generates `AIOIINABridge-v0.6.0-beta.2.zip`; it is **ad-hoc signed, not notarized**, and has not been validated on the user's Mac. It is a **beta build artifact**, not a replacement for a working v0.5.1 app. Do not install over the existing app before canary checks.

**New v0.6 beta implementation (off by default):** AIOIINABridge.app can save a short-lived callback session for approved AIO Web origins (explicit `allowed-origins.txt`) or Desktop `aiostreams://return`, and the Trakt+ plugin observes the existing close event to return the last valid playback position. No automatic Watched flag is emitted. The existing `v0.5.1` installed app stays intact. The new workflow packages a `v0.6.0-beta.2` Mac ZIP; the Python source must be tested with a Mac canary before production use.

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

## v0.6.0-beta.2 opt-in requirements (NOT installed)

The Mac launcher only creates callback sessions when the origin is explicitly trusted. Configure exactly the AIO Web origin, one line each, in:

```text
~/Library/Application Support/AIO-IINA-Bridge/allowed-origins.txt
```

Example origin syntax: `https://your-aio-host.example:18447` (replace with the actual configured AIO address); the Desktop `aiostreams://return` callback is also supported. No wildcards, unrelated websites, cookies, stream credentials or API keys are accepted as origins.

Trakt+ plugin Preferences → **AIO-IINA Companion (v0.6 canary)** → check **Enable AIOStreams return-on-close (beta)** only after the matching Companion beta has been installed and validated. The file stays disabled by default, and Trakt+ remains the sole Trakt writer. Playback is never blocked by a missing callback helper.

Test manual stop/close after >1 second playback and verify AIO Resume. EOF-to-Watched is intentionally **not enabled** until Trakt history echo suppression is proven on the user's server. Early source-switch callbacks are also deferred until window close for safety. No release automation auto-installs the Mac package.


## Mac canary protocol isolation

The **beta** is built as `AIOIINABridge-beta.app` with a distinct bundle
identifier `io.github.olivergiangvu.AIOIINABridge.beta`. It registers only
`aios-iina-beta://`. The existing stable `AIOIINABridge.app` remains the
handler for `aios-iina://` and must not be overwritten.

To test a single AIO Web/Desktop player link in **Custom Link** mode, temporarily
use (do not modify the stable custom link until the beta is installed and verified):

```text
aios-iina-beta://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}
```

The IINA Trakt+ plugin beta must also be installed from PR CI (back up the
existing plugin and its credentials first); stable v0.2.8 remains the rollback.
Enable `aio_callback_enabled` in the Trakt+ preference panel only during canary.

Canary acceptance: normal video playback, identical subtitle priority, trusted
title, correct resume, no signed URLs in logs, and AIO Web/Desktop Resume return
on closing the IINA window. **Natural EOF auto-Watched, x-error, and guaranteed
quit callbacks are not yet implemented**, nor is the exact AIO Web tab reused
necessarily guaranteed by `open`. These are the next gates, not advertised
as completed.

If the callback is not needed, turn the plugin preference back off and restore
the previous `aios-iina://` custom link. The production Companion and Trakt+
continue unchanged.

### v0.6.0-beta.2 callback return fix

Browser callback validation now supports AIO hosted at `/` or a safe reverse-proxy prefix while requiring the exact approved origin and `#/...` hash-route markers. The Companion logs redacted `AIO_CALLBACK_SESSION=created|not-created`, and its Python helper records `AIO_CALLBACK_RETURN=sent|failed|...` in `~/Library/Logs/AIO-IINA-Bridge.log`. IINA Trakt+ opt-in observer records `AIO_CALLBACK_OBSERVER=session-matched|...` in its existing plugin debug log. These are diagnostics for the **IINA → AIO** return leg; none contains stream URLs or OAuth data. No automatic `finished=1` or Watched events are enabled. Build v0.6.0-beta.2 side-by-side with stable, test before deployment.

## v0.7 identity-context Canary — extends existing Companion (off by default)

This extends **the already installed AIOIINABridge.app**, not a new helper. It
retains the working production Custom Link exactly:

```text
aios-iina://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}
```

Source branch: `feat/companion-identity-context-v07`. The **side-by-side
test app** uses `aios-iina-beta://` as earlier beta builds do, has a distinct
bundle identifier, and does not replace production v0.5.1. It contains
`identity_context.py`, which performs optional **read-only**, authenticated
identity lookup **after launching IINA**, so network failures do not prevent
video, subtitles or resume.

### What identity-context can prove

With a trusted AIOStreams browser return URL, the Companion extracts opaque
`played` and `source` IDs. It then queries the exact selected
`/Items?Ids=<played>&Fields=ProviderIds,ParentId`, parent `SeriesId`,
and `/Items/<played>/PlaybackInfo?MediaSourceId=<source>` using a **user
session token**, never an AIO admin token. It verifies:
- episode vs series, matching item/parent IDs and source version;
- season and episode from the AIO item, including against S/E in IINA title;
- canonical series year and the parent show's IMDb/TMDb/TVDB ProviderIds.

Only verified results become a **5-minute local identity envelope** at:

```text
~/Library/Application Support/AIO-IINA-Bridge/identity/identity-<random>.json
```

Files are 0600 in a 0700 directory. Each includes the exact original playback
URL **SHA-256 fingerprint**, show IDs, S/E, provenance, issue and expiry. No
stream or subtitle URL, return URL, session token, or Jellyfin API key is
persisted. The original IINA launch URL is untouched.

### Opt-in configuration (NOT required for playback)

The safe default is **disabled**. For a Mac Canary, a configuration file
`~/Library/Application Support/AIO-IINA-Bridge/identity-settings.json`
must exist with permissions 0600:

```json
{
  "enabled": true,
  "origin": "https://YOUR-TRUSTED-AIO-ORIGIN"
}
```

The exact HTTPS origin must also be in the existing
`~/Library/Application Support/AIO-IINA-Bridge/allowed-origins.txt` file,
which the companion callback branch already supports. No wildcard origins.

The optional user-scoped Jellyfin token is read **at runtime** from macOS
Keychain as a Generic Password with service `AIO-IINA-Identity-Token` and
Account equal to the **exact HTTPS origin**. Provision it through Keychain
Access or a secure interactive setup; do not paste it in shell commands,
Custom Links, repository files or issue logs. Confirm the associated AIO user
has permission to GET both the episode item and parent series and its chosen
PlaybackInfo. The current source has not proven that the deployed AIO
instance supports these reads with a user token.

For authentication errors, absent item/provider IDs, mismatched episode,
source, year, or unapproved return origins, **no identity file is written**.
The player still works. The existing Companion's subtitle lookup is
independent of this optional identity step.

### Current implementation boundary

**This Canary produces a sanitized identity envelope only.** Trakt+ and
Episode Info+ are not yet wired to consume the new envelope. A real,
end-to-end verified IINA recognition still requires read-only sidecar
consumers, correlation with the exact loaded media URL fingerprint, TTL,
and fresh verification on each provider. Do **not** describe this first
Companion build as end-to-end AutoMatch or install over the stable app.

Desktop `aiostreams://return/` is not yet supported for identity fetching;
without an HTTPS origin and authenticated API access it fails closed.
TheTVDB remains a fallback for missing parent show ProviderIds and TVB
alternate-title discovery — it is **not** a substitute for exact IDs/S/E.

Run in source checkout:
```bash
python3 companion/aiostreams-iina/bridge.py --self-test
python3 companion/aiostreams-iina/test_identity_context.py
```

No new Docker container, HomeDocker Trakt Bridge change, AIOStreams image
patch, Trakt writer or background service is required.
