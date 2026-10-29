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
