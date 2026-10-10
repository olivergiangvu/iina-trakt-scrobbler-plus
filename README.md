# Trakt Scrobbler Plus for IINA

An enhanced fork of [i3p9/iina-trakt-scrobbler](https://github.com/i3p9/iina-trakt-scrobbler) with initial support for **Remux / AIOStreams streaming URLs**.

**Current public test version: v0.2.1-beta.1.** This is an early test build, not a fully validated stable release.

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
