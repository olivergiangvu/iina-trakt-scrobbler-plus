# Trakt Scrobbler Plus for IINA

An enhanced fork of [i3p9/iina-trakt-scrobbler](https://github.com/i3p9/iina-trakt-scrobbler) with initial support for **Remux / AIOStreams streaming URLs**.

**Current stable release: v0.2.4.** Promoted directly from the verified v0.2.4-beta.6 canary after real IINA field tests of manual Movie/TV correction, MediaFusion S/E recognition, confirmed-pack lookup, Match Provenance, Sync Queue Review/Remove, live scrobbling, ⌘Q and end-to-end resume sync through the existing HomeDocker Trakt Bridge. Playback and Trakt API logic are unchanged from beta.6; only release metadata, CI packaging and documentation are updated. The separate Trakt Bridge remains independently managed.

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
- Trakt API write requests are serialized and paced (1.35 seconds apart), with persistent, bounded backoff on 429/Cloudflare 1015, short outage cooldown, and a 30-second background retry scan for saved stops when no playback is active.
- Sidebar shows connection status, retry countdown and unacknowledged stop count; Profile/History reads are cached and UI requests coalesced.
- Includes **Manual Correction**: show search and Trakt slug lookup work even if the parsed episode is wrong. Enter the correct Season/Episode, select the series and confirm only when Trakt verifies the episode.
- Keeps the original file-based Guessit parser, scrobble monitoring, sidebar and history.
- Uses its own IINA plugin identifier and token Keychain service.

**Not yet included:** Fresh IMDb/TMDB-first recognition when both player metadata and URL lack a trustworthy show ID. MediaFusion manual-confirmed pack cache is supported, but this is not an upstream series identity resolver.

## Supported test example

`The.Legend.of.Vox.Machina.S02E04.WEBDL...&media_id=tt11247158&media_type=series`

The plugin should identify the correct S02E04/S02E06 from player metadata rather than guessing S01E25/S02E90 from encoded tokens. Playback identification, resume and quit finalization have passed live IINA checks; when localized titles lack an IMDb ID, use Manual Correction.


## v0.2.4 Stable — validated feature summary

- Structured MediaFusion provider routes identify season/episode even for localized episode-only titles; never accept a show identity from the route alone.
- Manual Correct Match allows switching **Movie / TV Series**, editing Season/Episode and verifying the selected Trakt target.
- Confirmed MediaFusion torrent-season identity can be reused without copying stream credentials.
- Sync Queue includes pending confirmed stops, **Needs Review** for legacy unverified records, recent confirmations, safe two-step local cleanup, and Match Provenance.
- Rate-limit-aware retry, durable proven checkpoints and redacted Copy Diagnostics.
- Mac field validation PASS: live scrobbling, manual match, cached recognition, Review Remove UI and ⌘Q resume delivered through Trakt Bridge to downstream clients.

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
- Sudden app termination may prevent an immediate stop API request; the local unacknowledged checkpoint is retried on next plugin launch or while idle after Trakt recovers (up to 48 hours).
- Rate limiting is local to this IINA plugin, not globally coordinated with the separate HomeDocker Trakt Bridge process.
- Never store stream URLs or Trakt authorization tokens in the stop journal. Existing `@data` plugin storage is used.

## v0.2.4 beta — Sync Queue Dashboard

This beta is built from a feature branch. **v0.2.3 remains the stable release.**
It adds a list of durable, final-stop progress updates awaiting Trakt confirmation
(Pending / Syncing) and the latest 12 confirmed stop updates (Recently Synced).
Last failure reason/time is visible in the Trakt API status. Records are locally
bounded, and the recent-sync record expires after seven days.

**Retry Now** respects the existing API cooldown and is disabled during playback,
while an earlier retry is running, or when disconnected. Automatic 30-second
recovery remains enabled. Only final `stop` records are replayed; we do not
replay stale `start` events.

**Beta installation:** download the `.iinaplgz` asset from the v0.2.4-beta.1
[GitHub prerelease](https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/releases/tag/v0.2.4-beta.1)
and open it with IINA on the **Mac**. Using Install from GitHub
normally selects the *latest stable* release, so it may remain at v0.2.3.
No Terminal, SSH, HomeDocker stack edits or bridge changes are needed.

**Validation plan:** IINA sidebar should show Pending and Recently Synced,
Retry Now should be disabled when the API is rate limited or the player is active,
and quit/resume progress should still flow through the existing Trakt Bridge.

### v0.2.4-beta.2 — False-positive matching protection

The first v0.2.4 canary exposed a pre-existing bug in title-only matching:
Trakt's top result could be accepted despite a completely unrelated title.
The v0.2.4-beta.2 canary requires canonical title equivalence for title-only
movie matches (folds accents/case), revalidates old numeric match caches,
and still allows explicit manual selection or confirmed IMDb matching.

In the Trakt+ sidebar, use **Playback Diagnostics → Copy Diagnostics**
to copy a **redacted** JSON record of the current IINA stream. It includes
filename, metadata titles, host, URL path shape, available IMDb IDs and
parameter **names**, not auth values, stream tokens, or bearer URLs.
For two problematic playback links, start each briefly and copy diagnostics
separately. Never publish complete signed MediaFusion/TorBox URLs.

This is a canary only; main stays at v0.2.3 stable.

### v0.2.4-beta.3 — MediaFusion episode metadata and secure show learning

Real macOS diagnostics exposed: `Strom ozvěny` (localized Czech episode
title) played via MediaFusion TorBox URL with explicit `/2/8` route.
MediaFusion route source independently confirms that suffix is Season 2,
Episode 8. Official Czech metadata lists this as The Legend of Vox Machina
S02E08 (The Echo Tree).

Trakt+ now reads the season/episode from this structured MediaFusion route
rather than treating isolated episode-title metadata as a movie. **A route
alone does not identify the show.** Until the user chooses a show using
Correct Match (or has an explicit trusted IMDb ID), scrobbling is blocked.
Once a correct show is selected and Trakt confirms that S/E exists, the
plugin remembers the chosen Trakt show for the same torrent fingerprint
and season only, expiring after 60 days. No stream URLs, signed credentials,
or raw infohash are stored in this mapping. Each new episode must be
verified once with Trakt; its result then benefits from existing caching.

Instructions: open MediaFusion stream -> Trakt+ sidebar -> Correct Match ->
search `The Legend of Vox Machina` -> select correct show (S02E08 is
pre-filled) -> confirm and resume. Verify Trakt and downstream bridge
progress before marking this canary stable.

**v0.2.3 remains stable; beta releases are manual installs on Mac.**

### v0.2.4-beta.4 — Manual Search type override

With some local-language MediaFusion playback titles, IINA can only
observe the localized episode name and may parse it as a movie. The Manual
Match UI formerly inherited that guessed media type, making TV series
impossible to search and hiding Season/Episode controls.

Manual Match now includes an explicit **TV Series / Episode** versus **Movie**
selector. Switching types clears stale results, routes Trakt searches and ID
lookups through the correct API resource, and shows editable Season/Episode
independently of the original parser decision. Structured MediaFusion
season/episode values prefill the form. Applying a TV selection converts
the current media identity from the guessed movie to an episode after Trakt
validates the specified show and S/E. A mismatched result type cannot be
applied. Confirmed MediaFusion torrent-season learning remains supported.

**Beta testing:** Install the GitHub v0.2.4-beta.4 prerelease file manually
on the Mac; v0.2.3 remains the Latest Stable release.

### v0.2.4-beta.5 — Provenance & Queue Integrity

**Safety update after real user tests:** local beta.4 had two unverified
stops (`Strom OzvěNy` as a movie and `Unknown Series S02E08`).
These and other legacy checkpoints without trusted evidence now appear under
**Needs Review**. They are retained on disk and **never auto-sent**.
Each may be removed locally only via a deliberate two-click confirmation.
Removal does not delete Trakt history or watched data.

**New durable stop checkpoints** are persisted for automatic recovery only
with an explicitly confirmed manual Trakt ID, a valid IMDb ID or a Trakt
identity confirmed by a prior successful request. For older filename-only
metadata, live playback still uses the existing Trakt resolver, but will not
durably replay an unproven final stop on network failure. This deliberately
favours avoiding wrong historical writes over maximum offline retry coverage.

The sidebar shows **Match source**: Direct IMDb ID, Manual Confirmed,
Confirmed Pack Cache, Trakt Verified or Unverified / Needs Manual Match.
On a proof-backed retry, Trakt show S/E or movie identity is validated
before sending progress. Invalid proofs move to Needs Review.

**Earlier beta install:** download the v0.2.4-beta.5 .iinaplgz prerelease asset,
open with IINA on Mac, restart. The latest stable v0.2.3 and the independent
HomeDocker Trakt Bridge are not changed. Test normal pause/stop, quit/resume,
confirmed-pack source label and Needs Review. Do not promote until user confirms.

### v0.2.4-beta.6 — IINA sidebar Review Remove interaction fix

A macOS field test confirmed Match source, 0 pending / 2 Needs Review,
Recently Synced and correct The Legend of Vox Machina S02E08.
But the two dynamically-rendered Remove buttons appeared inert in IINA.
Unlike static sidebar buttons they listened only to `click`, which IINA's
sidebar WKWebView does not reliably deliver after a pointer interaction.

The review buttons now handle `pointerdown`, `click` fallback and keyboard
activation, with same-gesture de-duplication. First press reveals a clear
confirmation and Cancel option; second press removes only that local legacy
unverified checkpoint. The backend always acknowledges success or failure
and refreshes the sidebar; removal is permitted while video is playing and
cannot delete a verified stop. Item titles/reasons wrap to remain readable.

Validated by new interaction regression test and the full CI suite.
Release is a manual-install **prerelease**; v0.2.3 remains latest stable.
No HomeDocker or Trakt Bridge changes are required.

**Historical beta notes above are retained as development records. v0.2.4 is now stable.**

## v0.2.5-beta.1 — Fresh Explicit-ID Recognition (canary)

**Goal:** recognize a *new*, previously unseen TV series/movie on the first
playback **when a trusted source link actually contains an external ID**.
No TMDB API key is required: the plugin uses its existing authenticated
Trakt connection for IMDb IDs and TMDB-to-Trakt ID lookup.

- Recognizes explicit `media_id=tt...`, `imdb_id=...`, `tmdb_id=...`,
  `media_id=tmdb:<number>` and Stremio `/stream/series/tt...:S:E.json`
  style IDs. Never extracts IDs from opaque MediaFusion secrets or torrent hashes.
- MediaFusion's `/.../season/episode` can supply the S/E position but **not**
  the series itself. Conflicting external IDs or disagreeing episode positions
  are rejected rather than auto-scrobbled.
- Fresh matches are asynchronously verified against Trakt. The correct
  canonical movie/show title and exact existing S/E are required before
  live scrobble is permitted. Stale network responses are ignored if the user
  switches playback or manually overrides the match mid-request.
- Match Source indicates fresh IMDb/TMDB verification; Copy Diagnostics
  exposes only safe IDs and URL shapes, not stream URLs or credentials.
- Existing manual-correction, pack cache, Sync Queue and quit/resume logic
  remain unchanged after successful verification.
- **Important limitation:** a bare MediaFusion URL such as
  `/streaming_provider/[secret]/playback/torbox/[hash]/2/8` together with
  only a Czech localized episode title `Strom ozvěny` **does not carry a
  trustworthy show ID**. Fresh matching on *that precise URL* still requires
  a confirmed pack match, a manual correction, or an upstream link that
  includes an IMDb/TMDB ID. This beta does not guess by localized titles.

**Installation:** download the v0.2.5-beta.1 prerelease `.iinaplgz` asset
from GitHub and open on the **Mac** with IINA. Stable v0.2.4 is untouched.
No SSH, HomeDocker or Trakt Bridge configuration changes are needed.

**Beta acceptance:** first playback from an ID-bearing custom URL resolves
without any prior manual pack cache, the verified show and S/E are reported
to Trakt, a URL with conflicting IDs never scrobbles, and ⌘Q resume still
synchronizes to downstream clients.
