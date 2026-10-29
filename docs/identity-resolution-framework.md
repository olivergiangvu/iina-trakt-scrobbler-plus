# IINA Cross-Catalog Identity Resolution Framework — v1

## Problem and evidence
A HLS playback can expose only `index.m3u8` and a label such as
`City of Splendour · S01E02 · Episode 2`. Its canonical TV series can
be named `This City Never Sleeps` by Trakt/TMDb.

Verified real-world example (2026-10-29):
- Trakt show `289996`; IMDb `tt39443161`; TMDb `295002`.
- Trakt `/shows/289996/aliases` was empty, and a 20-item search for the
  player name did not contain that show.
- User's IINA field test: Trakt+ v0.2.9-beta.5 scrobbled correct S01E02;
  EP+ v1.3.4-beta.4 returned TMDb verified S01E02.
- This fixed example came from a reviewed TheTVDB alternate title (483239).
  It is **not** evidence that unknown aliases can be inferred from title alone.

## Identity resolution order
1. Extract full trusted external identifiers (IMDb/TMDb) when available from
   playback metadata; verify the identity using the destination provider.
2. Search for the exact canonical title + release year; if variants exist,
   verify a provider-attested alternate title, not a relevance score.
3. Find exact, reviewed external-catalog alias in the **shared identity
   contract** (trusted-series-aliases.js). Require corroborated IMDb/TMDb
   and Trakt show identity (if available) and exact season/episode.
4. For a previous explicit **user-confirmed show selection**, load the
   versioned `@data/verified-title-mappings.json` and revalidate identity.
   User mappings are scoped to the **exact HLS origin hostname**.
5. If no unique verified candidate exists, **fail closed** and show
   Correct Match / manual search. Never silently guess from fuzzy titles.

## Portable schema
Both IINA plugins use the same version-1 JSON contract:
```json
{
  "version": 1,
  "records": [{
    "kind": "episode",
    "alias": "Localized or alternative player title",
    "canonicalTitle": "Provider canonical title",
    "year": 2025,
    "imdb": "tt12345678",
    "tmdb": 22222,
    "trakt": 0,
    "source": "user-confirmed",
    "originHost": "cdn.example",
    "evidence": "user-confirmed episode selection"
  }]
}
```
A Trakt ID of `0` means *unknown*, not a match. Trakt+ can independently
resolve IMDb -> Trakt and then re-check TMDb/year and the exact episode.
A title alone is never authoritative; every known ID must agree. Records
with conflicting identities are rejected. Older or malformed JSON is
ignored. No watch history or tokens are stored in these records.

## Learning a new alias
- Trakt+: selecting an episode's **Correct Match** checks that episode
  exists at the chosen Trakt show. If Trakt supplies a valid canonical
  show, IMDb, TMDb and release year, it can persist the confirmed alias
  under the stream hostname for following episodes. Existing manual
  correction and verified show cache continue to work.
- EP+: manually selecting a TMDb show and episode causes the plugin to
  re-fetch show details and episode metadata, re-check the *current*
  playback S/E and runtime, then store the confirmed title mapping.
  Subsequent episodes on the same hostname can match automatically.
- Both plugins keep data in their own `@data` sandbox; **they do not
  automatically exchange learned mappings yet**. Their record structure
  is intentionally interoperable for a future safe import/sync feature.

## Safeguards and caveats
- Only the **origin hostname** is persisted, never the HLS URL, stream
  token, OAuth credentials, API keys or query strings.
- Manual/user-confirmed mappings may be revalidated on subsequent
  lookups; revalidation must reject ID/year/S-E mismatches.
- Known verified aliases should be treated as source-scoped or
  year-scoped when conflicts are possible.
- An old Trakt v2 `manual` cache without an origin host may retain its
  previous behavior until explicitly corrected; this migration does not
  silently erase it.
- Provider outages and missing IMDb IDs mean **unverified**, not
  `no show exists`.
- Same alias can refer to multiple shows; a missing year or conflicting
  ID must fail closed. Search popularity is not identity evidence.

## Next integration milestone
For genuinely zero-touch matching of **previously unseen** aliases:
- Preserve IMDb/TMDb IDs in AIOStreams -> IINA metadata before the
  opaque HLS URL loses them; alternatively use a vetted provider alias
  discovery API (credentials/license and trust policy required).
- Consider one centrally hosted, versioned identity registry on
  HomeDocker with read-only clients, conflict review and source
  provenance; do not automatically trust arbitrary internet search.
- Add explicit UI controls to inspect, correct and revoke remembered
  aliases, and synchronize only approved mappings between plugins.


## Proposed v2 (corrected): extend the EXISTING AIO-IINA Companion

### Existing production components — do not duplicate
The user already has **AIOIINABridge.app v0.5.1** installed as the macOS
Custom Link helper for IINA. Do not design another independent handoff app,
new daemon, new local proxy or a second Trakt writer.

The exact **current production** AIOStreams Custom Link is:

`aios-iina://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}`

The existing Companion handles this link and launches official IINA through
`iina-cli`, with the original signed playback URL unmodified,
`--mpv-force-media-title`, `--mpv-start`, and VI/EN subtitle priority.
Its existing source lives **in this same Trakt+ repository, on branch
`beta/aiostreams-xcallback-v0.6`**, rather than in the root plugin folder:
- `companion/aiostreams-iina/bridge.py` (v0.5.1 launch logic);
- `companion/aiostreams-iina/README.md`;
- `companion/aiostreams-iina/callback_session.py` (v0.6 beta only, not assumed deployed);
- `docs/proposals/aio-iina-xcallback-v0.6.md` (opt-in callback).

**Already implemented in Companion**:
- `parse_link()` reads `url/title/position/sub/context`;
- `return_context_info()` reads first-party `{returnUrl}` browser query/fragment
  and extracts opaque `played` (AIO/Jellyfin Item ID) and `source` (MediaSource ID);
- `selected_source_subtitles()` already uses these to perform a bounded,
  same-origin GET to `/Items/{item}/PlaybackInfo?MediaSourceId={source}`,
  validates subtitle URL/source associations, then launches IINA;
- raw stream URLs and subtitle credentials must never enter logs or
  persistent identity mapping.

**Important limitation verified in current source**: `return_context_info()` only
accepts HTTP(S) browser return URLs, although `parse_link()` also accepts
`aiostreams://return/...` (desktop callbacks). Thus do NOT claim the existing
PlaybackInfo identity pathway already works for every AIO desktop launch.
The v0.6 callback beta and the installed v0.5.1 are distinct components.

### AIOStreams tokens: existing vs proposed
Upstream Custom Link currently expands:
`{url}`, `{encodedUrl}`, `{scheme}`, `{filename}`, `{subtitles}`,
`{title}`, `{position}`, `{positionMs}`, `{returnUrl}`.
There is currently **no built-in** `{imdb}`, `{tmdb}`, `{tvdb}`,
`{seriesId}`, `{season}`, or `{episode}`
token in `packages/web/src/lib/playback/player-choice.ts`.

### Integration plan — evolve bridge.py, preserve Custom Link
1. Keep `aios-iina://play` **unchanged**. Extend Companion's existing
   context and selected-source handling; avoid another Mac app, second URL scheme
   in production, or another playback launcher.
2. Treat `{returnUrl}` `played/source` as *opaque lookup keys*,
   **not trusted IDs proving series identity**. Verify allowed AIO Web origin,
   match the selected MediaSourceId, and support Desktop callback format only
   with a separately tested authenticated item-lookup path.
3. With an authorized, user-scoped AIO/Jellyfin session, query the exact item
   (`/Items?Ids=<played>&Fields=...`) and its `SeriesId` parent show. Check
   `Type=Episode`, `ParentIndexNumber`, `IndexNumber`, selected source
   and available `ProviderIds` (IMDb/TMDb/TVDB). The existing public
   PlaybackInfo GET is **not** proof that authenticated /Items lookup works:
   investigate permission and token source separately. Do not embed AIO
   admin/Jellyfin API keys into Custom Link or logs.
4. Add a **short-lived sanitized identity envelope** on Mac with schema version,
   verified source/parent show IDs, year, S/E, provenance and expiry. Coordinate
   with both IINA plugins using a shared **read-only local sidecar** or an
   existing beta callback session journal that correlates exact URL SHA-256,
   launch ID and expiry. File mode 0600, private directory 0700, atomic writes.
   Never persist the raw signed media URL/return URL/tokens in this identity
   envelope. `callback_session.py` in v0.6 is *beta-only*, so integration
   must not assume it is already available with v0.5.1.
5. Trakt+ and Episode Info+ each **independently re-check** IMDb/TMDb/Trakt
   identity, year, S/E and episode ordering against provider APIs. The
   Companion is an *identity context producer*, never a Trakt writer.
6. If item metadata is unavailable, preserve existing playback/subtitle/resume
   behavior and fall back in order to verified provider aliases, TVDB candidate
   discovery, learned user-confirmed alias mapping and Correct Match.
7. Keep the x-callback (IINA -> AIO resume) as a separate, opt-in v0.6
   feature. Do not turn on EOF->Watched or create another Trakt writer as part
   of identity improvement.

### TheTVDB: best new discovery layer for TVB/Asian alternate titles
TheTVDB 483239 independently associates the alias `City of Splendour`
with 璀璨之城, whose Trakt catalog identity is
`This City Never Sleeps` 289996 (IMDb tt39443161, TMDb 295002).
Trakt's native alias list is empty, and its player-title search omitted the
correct result. TVDB is a strong **candidate discovery** source when
AIOStreams cannot pass an existing provider ID. It is not a replacement
for IMDb/TMDb/Trakt identity and exact S/E verification.

Prioritize exposing TVDB evidence from AIOStreams' existing metadata/
ID-mapping configuration when available. If an additional TVDB API adapter is
necessary, centralize its credentials and observe TheTVDB licensing, terms,
attribution and API limits. Do **not** install independent TVDB API keys in
both IINA plugins by default. Check aired vs DVD/absolute episode order.

### Regression and rollout gates
- Existing Companion preserves raw stream URL byte-for-byte, subtitle
  priority VI>EN, title and resume position; no second process/player launch.
- Browser `{returnUrl}` gets exact item + source; AIO desktop return scheme
  is tested separately, never treated as though already implemented.
- Untrusted origin, wrong item/source, absent/contradictory ProviderIds,
  mismatched year/episode, expired context and multi-window concurrency
  must **fail closed** for identity while playback continues.
- HLS `index.m3u8` and tokenized streams remain playable.
- Both plugins see **the same short-lived sanitized identity**, independently
  verify it and cannot accidentally scrobble unrelated movies/series.
- Keep production `AIOIINABridge.app` (`aios-iina://`) untouched.
  Build/test side-by-side beta `AIOIINABridge-beta.app`
  (`aios-iina-beta://`) in the existing Companion source branch.
- No AIOStreams image changes, new Docker service, stable release, or
  HomeDocker Trakt Bridge changes until explicit integration testing proves
  the handoff and non-duplicate scrobble behavior.

### Exact source references
- https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/blob/beta/aiostreams-xcallback-v0.6/companion/aiostreams-iina/bridge.py
- https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/blob/beta/aiostreams-xcallback-v0.6/companion/aiostreams-iina/callback_session.py
- https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/blob/beta/aiostreams-xcallback-v0.6/companion/aiostreams-iina/README.md
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/player-choice.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/external-return.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/now-playing.ts
