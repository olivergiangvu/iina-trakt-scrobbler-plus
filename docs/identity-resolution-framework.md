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


## Proposed v2: AIOStreams first-party launch context + TheTVDB discovery

### What is actually present in the upstream custom external-player link (2026-10-29)
Source: `Viren070/AIOStreams`:
- `packages/web/src/lib/playback/player-choice.ts`
- `packages/web/src/lib/playback/play.ts`
- `packages/web/src/lib/playback/external-return.ts`
- `packages/web/src/lib/playback/now-playing.ts`
- `packages/web/src/lib/queries.ts`

**Current supported Custom Link tokens:** `{url}`, `{encodedUrl}`, `{scheme}`,
`{filename}`, `{subtitles}`, `{title}`, `{position}`, `{positionMs}`,
`{returnUrl}`. **No** `{imdb}`, `{tmdb}`, `{tvdb}`, `{seriesId}`, `{episode}`,
or arbitrary formatter `{metadata.*}` expansion in the external player template.
AIOStreams Custom Formatter placeholders are a separate template namespace.

**Key discovery:** AIOStreams' `externalReturnUrl()` includes
`played=item.Id` and `source=source.Id` in a first-party callback URL.
These are opaque, internal **AIOStreams/Jellyfin IDs** — **not IMDb/TVDB IDs**.
They can identify a media-server item and selected version *after authenticated
lookup*; they are not authenticated proof by themselves.

The AIOStreams web app already reads `item.SeriesId` and uses
`show.ProviderIds.Imdb` for episodes in `now-playing.ts`. Item lookup uses
`GET /Items?userId=...&Ids=<item.Id>&Fields=...` via an authenticated
Jellyfin client (queries.ts). A launch context could retrieve that exact
episode item plus its parent show and cross-provider IDs from AIOStreams,
instead of re-searching by a localized title.

### Recommended integration
1. Use a custom Mac URL handler or a small locally installed handoff helper,
   not a raw `iina://weblink` query parameter IINA might discard:
   `aios-iina://open?stream={encodedUrl}&title={title}&filename={filename}&position={position}&context={returnUrl}`.
   This is a **proposed** template, not usable until the helper is installed.
2. Parse only **allowlisted AIOStreams origin URLs**, extract the internal
   `played` and `source` IDs; do not trust query parameters as metadata proof.
3. Resolve the item through the user's *authenticated* AIOStreams media server;
   verify its `Type=Episode`, `SeriesId`, `ParentIndexNumber`,
   `IndexNumber`, parent `ProviderIds` and matching `MediaSourceId`.
   Provider IDs may be absent; do not invent missing IDs.
4. Supply a versioned launch context (or short-lived, locally signed identity
   envelope) to IINA plugins. Include show IDs, S/E, origin, authoritative
   source and expiry; omit playback credentials and raw stream URL from
   persistent identity cache.
5. Both plugins validate externally supplied IDs again against Trakt/TMDb
   before scrobbling/showing verified metadata; stale, contradictory or
   cross-user contexts **fail closed**.
6. A future upstream contribution could add direct, whitelisted
   `{itemId}`, `{seriesId}`, `{imdb}`, `{tmdb}`, `{tvdb}`, `{season}` and
   `{episode}` placeholders to AIOStreams' playerLink. AIOStreams' current
   source code does NOT implement these tokens.

### TheTVDB fallback for Asian / TVB titles
TheTVDB series 483239 displays **璀璨之城** with alias **City of Splendour**;
Trakt has **This City Never Sleeps** show 289996 (IMDb tt39443161,
TMDb 295002), but Trakt alias list is empty. This makes TVDB a valuable
**discovery** source, not automatically the final authority to scrobble.

Recommended chain:
`query alias/translation (TVDB) → candidate TVDB series →
cross-check TVDB remote IMDb/TMDb IDs with Trakt/TMDb →
confirm country/year and S/E order → verified identity`.
Respect TVDB broadcast vs DVD/absolute episode orders: do not blindly map
S01E02 between all catalogs.

AIOStreams already exposes `TVDB_API_KEY`, `ID_MAPPINGS_ENABLED` (default
true, Wikidata-fetcher CSV), `TITLE_CONFLICTS_ENABLED` and TMDb; prefer one
server-side TVDB adapter/verified identity broker rather than a separate key
in each IINA plugin. TVDB v4 needs legitimate project API credentials and
has licensing/attribution requirements. Do not scrape HTML as a substitute.

### Security and rollout
- Never log or persist signed stream URLs, auth tokens, return URLs containing
  credentials, or the AIOStreams media-server admin API key.
- The Custom Link `{returnUrl}` gives *item identifiers* only; the helper
  must authenticate with a scoped user session and cross-check both item and
  selected version. An admin AIOStreams API key is broadly privileged and
  should not be embedded in launch URLs or distributed to every Mac client.
- A Custom Link-based helper must be registered as a macOS protocol handler.
  The current `iina://weblink?url=...` format alone does not guarantee that
  unknown query fields reach either IINA plugin.
- When playback starts outside AIOStreams (raw `index.m3u8`), this handoff
  context is unavailable; keep TVDB discovery / user-confirmed learned aliases
  as safe fallbacks.
- Keep PRs in draft and the working beta.5/beta.4 installed until an actual Mac
  test demonstrates first-party item-id context and non-ghost remote scrobble.

References:
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/player-choice.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/external-return.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/now-playing.ts
- https://docs.aiostreams.viren070.me/reference/addon-protocol/metadata/
- https://docs.aiostreams.viren070.me/configuration/environment-variables/
- https://www.thetvdb.com/series/483239
- https://thetvdb.com/api-information
