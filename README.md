# Trakt Scrobbler Plus for IINA

An enhanced fork of [i3p9/iina-trakt-scrobbler](https://github.com/i3p9/iina-trakt-scrobbler) with initial support for **Remux / AIOStreams streaming URLs**.

**Current public test version: v0.2.2-beta.1.** This is an early test build, not a fully validated stable release.

## Install directly from IINA (recommended)

1. On **your Mac**, open **IINA → Settings → Plugins**.
2. Choose **Install from GitHub**.
3. Enter: `olivergiangvu/iina-trakt-scrobbler-plus`
4. Install, restart IINA, open the **Trakt+** sidebar and authenticate.
5. **Disable scrobbling in the original Trakt Scrobbler** while testing Plus; otherwise both plugins can report the same playback.

No Mac Terminal or HomeDocker/SSH commands are required for installation.

Alternative: download the `.iinaplgz` file from [GitHub Releases](https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/releases) and open it with IINA.

## What Plus currently adds

- Reads IINA/mpv's human-readable filename, media title and embedded metadata before falling back to encoded stream paths.
- Detects `torrent_name`, `filename`, and related URL query parameters.
- Extracts IMDb references such as `media_id=tt11247158`.
- Uses IMDb-first lookup on Trakt for eligible movies/shows.
- Verifies season and episode existence before scrobbling.
- Sends a final Trakt stop when the IINA window closes, and writes a local checkpoint before network transmission so it can retry a failed/aborted stop after relaunch.
- Includes **Manual Correction**: show search and Trakt slug lookup work even if the parsed episode is wrong. Enter the correct Season/Episode, select the series and confirm only when Trakt verifies the episode.
- Keeps the original file-based Guessit parser, scrobble monitoring, sidebar and history.
- Uses its own IINA plugin identifier and token Keychain service.

**Not yet included:** TMDB API-based matching for localized titles without a usable IMDb ID, and persistent per-stream manual override memory. These will require separate development.

## Supported test example

`The.Legend.of.Vox.Machina.S02E04.WEBDL...&media_id=tt11247158&media_type=series`

The plugin should identify the correct S02E04/S02E06 from player metadata rather than guessing S01E25/S02E90 from encoded tokens. Live IINA verification is pending; if a localized title cannot be mapped by Trakt and no IMDb ID is available, choose the correct show and episode in Manual Correction.

## Releases and auto-update

GitHub Actions tests source files and automatically packages an installable `.iinaplgz` asset whenever a **new version** is merged to `main`.
Each release must increment both `version` (semantic display version) and the integer `ghVersion` in `Info.json`. IINA detects updates through `ghRepo` and `ghVersion`.

Developers can follow [MAC-only testing and rollback instructions](docs/PLUS_BETA_TESTING.md).

## Attribution and license

Fork of [i3p9/iina-trakt-scrobbler](https://github.com/i3p9/iina-trakt-scrobbler), originally authored by Fahim and distributed under **GPL-3.0**. Stream URL metadata concepts are inspired by [Zain-Imam/iina-episode-info](https://github.com/Zain-Imam/iina-episode-info) (MIT).

The original GPL-3.0 license is retained. This fork is independent and is not an official release of the upstream project.

## Test Trakt resume persistence — Mac / IINA only

1. Keep Trakt+ connected and disable live scrobbling in the **original** Trakt plugin.
2. Play an episode using IINA, seek to ~40%, allow it to play for a few seconds.
3. Close the IINA player window / quit IINA. Trakt should receive `/scrobble/stop` and save the `pause` progress for resumes at less than 80%. If IINA closes before the request completes, the checkpoint is retried when IINA opens next time.
4. Wait briefly, then check the episode's playback progress in Trakt; do **not** reopen and play that episode before checking, since Trakt `/scrobble/start` clears its existing saved resume progress while playback is active.
5. For a separate unwatched test episode, stop after 80% and verify a watched entry in Trakt history. Do not use this watched test unless you intend to mark the episode watched.

### Scope / limits

- This stores checkpoints **only on playback stop**, not every 10 seconds while watching. Trakt live watching status does not include a continuously updated resume point.
- This release does not automatically push progress to AIOStreams. Whether AIOStreams imports Trakt's paused progress is a separate integration concern.
- Sudden app termination may prevent an immediate stop API request; the local unacknowledged checkpoint is retried on next plugin launch (up to 48 hours).
- Never store stream URLs or Trakt authorization tokens in the stop journal. Existing `@data` plugin storage is used.
