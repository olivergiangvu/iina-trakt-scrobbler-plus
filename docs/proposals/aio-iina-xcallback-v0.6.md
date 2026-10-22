# AIOStreams → IINA: Infuse-style x-callback return (design gate v0.6)

**Status:** v0.6.0-beta.1 implements opt-in window-close Resume callback, offline tests, a separate beta macOS bundle/protocol and CI. It does **not** implement verified EOF-to-Watched or x-error callbacks and has **not** been tested on the user’s Mac. No production deployment. Branch: `beta/aiostreams-xcallback-v0.6`.

## Goal and boundaries

Keep existing IINA 1.5.0, Trakt Scrobbler Plus stable v0.2.8, AIOIINABridge.app 0.5.1 launch/subtitle workflow and HomeDocker Trakt Bridge v1.5. Exact v0.5.1 launcher source was recovered from the user's Library and imported unchanged into `companion/aiostreams-iina/bridge.py`; neither that source nor the newly staged `.app` packaging has yet been tested against the currently installed binary on the user's Mac. Keep the deployed v0.5.1 app untouched.

No AIOStreams source/image changes, no new Docker container or background server, no second Trakt writer. Callback channel is **IINA → AIO**; Trakt+ remains **IINA → Trakt**. The HomeDocker Fast Lane `Trakt → AIO` is separate.

## Exact upstream contracts (as audited 2026-10-22)

- AIO `playerLink()` supports `{encodedUrl}`, `{title}`, `{position}` (seconds), `{subtitles}` (repeating), `{returnUrl}` (encoded once for a query parameter).
- AIO `externalReturnUrl()` generates `https://<origin>/...#/...?...&played=<id>&source=<id>` (Browser) or `aiostreams://return/...?played=<id>&source=<id>` (Desktop).
- Its `useExternalReturn()` consumes `position` (integer **seconds**, as mpv time-pos), `finished=1`, `played`, `source`; the callback must preserve source identity.
- Infuse 8.4.7+ `x-success` returns `lastPlayedUrl` and `position` in **seconds** after playback/close, `x-error` for failure. Native IINA scheme does **not** support an x-callback return; companion code must implement it.
- IINA Plugin API supports `mpv.end-file`, `iina.window-will-close`, `mpv.time-pos.changed`, `core.status.position`, `core.status.duration`, `file.read` and `utils.exec`.

Sources:
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/player-choice.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/external-return.ts
- https://github.com/Viren070/AIOStreams/blob/main/packages/web/src/lib/playback/play.ts
- https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services
- https://docs.iina.io/interfaces/IINA.API.Event

## New AIO Custom Link (beta v0.6; old stable links keep working)

```text
aios-iina-beta://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}
```

Keep `context` as original AIO-generated return address, rather than constructing identity from media title or video URL. The AIO helper `fillParam` URL-encodes `{returnUrl}` when inside a query parameter. Never decode twice.

## Implementation contract

1. **Mac launcher 0.6 (`companion/aiostreams-iina/` in this same Trakt+ repo):** safely parse and validate `context`, create permission 0700 session directory and 0600 session descriptor with cryptographically random per-launch id, item/source/return context (not logs), TTL and stream URL SHA-256 correlation. Keep unchanged signed source URL, title fragment, subtitle selection and resume.
2. **IINA listener (in this repo, opt-in only):** correlate playback to `session id`; read mpv time position and duration, capture a bounded last-good position journal; use `mpv.end-file` and `iina.window-will-close`; no callback for unrelated media or another window. On normal close/stop/EOF issue at most one terminal callback, idempotent per session.
3. **Callback:** add `position=<nonnegative integer seconds>` to the *original* AIO return URL; `finished=1` only on verifiable EOF or explicit safe played decision after canonical duplicate checks. AIO Web requires current authenticated session for reporter request; Desktop `aiostreams://return` must reach originating app instance. For malformed/missing context, remain Trakt-only.
4. **Errors:** bad/unplayable media triggers local failure feedback; optional `x-error` is supported by the local client contract but AIO `useExternalReturn` does not yet interpret error metadata—do not misrepresent it as upstream error UI.
5. **Security:** restrict return destinations to exact known AIO HTTPS authority or `aiostreams://return`; no generic arbitrary `open` or HTTP redirects, never emit signed `lastPlayedUrl` to third parties, no secrets in telemetry.
6. **Single Trakt writer:** Trakt+ already writes playback. AIO `position` or `finished` callbacks may create Jellyfin playback events and Bridge echo to Trakt; prove canonical-history echo suppression in Bridge before enabling `finished=1`, never rely on unverified assumption that duplicates cannot occur.
7. **Termination:** `⌘Q` is best-effort, force-kill/crash cannot guarantee return; retain Trakt+ + HomeDocker fallback without a permanent helper process.
8. **Multi-file playlist:** v0.6 MVP supports exactly one active AIO launch at a time per playback window. Later versions can map per-item position; do not claim Infuse multi-URL callback parity until tested.

## Acceptance matrix

| Case | Expected |
| --- | --- |
| Open movie and pause/stop midstream | AIO resumes from correct integer seconds; no false Watched |
| Finish naturally | Immediate AIO Watched only when safely guarded against duplicate Trakt history |
| Switch episode or source | No callback attributed to wrong item/source |
| Web AIO origin | Return via validated original https page |
| Desktop AIO origin | Return via `aiostreams://return` |
| External subtitles and signed stream | Existing playback/VI,EN selection unchanged |
| Manual `⌘Q` | Best-effort last-position callback; fallback Trakt for missed exit |
| Invalid custom URL, expired signed URL | No arbitrary return redirect or private data leak |
| Plain IINA playback | No callback |
| Callback already processed | Idempotent; no double open/history |

## Implementation order

1. [Completed — source only] Recover exact 0.5.1 launcher and import into `companion/aiostreams-iina/bridge.py`; run macOS beta package CI and verify source/package versus installed app before replacing it.
2. Add isolated callback contract + fixture tests; keep flag off.
3. Add Mac launcher session journal and IINA main-entry observer, opt-in.
4. Canary on user Mac: stop, EOF, ⌘Q, Web, Desktop; verify IINA Trakt+ & Bridge duplicate protections.
5. Only then merge and publish v0.6 stable. Keep 0.5.1 and stable Trakt+ rollback.


## Code landing and limits (v0.6.0-beta.1)

Implemented:
- \`companion/aiostreams-iina/callback_session.py\` creates time-bounded,
  0600-mode session rows containing only SHA256 of the signed URL, and
  validates allow-listed web origins or \`aiostreams://return\`.
- \`companion/aiostreams-iina/bridge.py\` preserves video URL, title,
  source-specific subtitles and resume, then creates an optional session.
- \`aio-companion-callback.js\` uses the Trakt+ main-entry file-loaded,
  time-position, and window-close lifecycle. At close it invokes the
  local companion helper by opaque session id and integer seconds (never media
  URL in the helper arguments), with one-time receipt.
- Root Info.json flag \`aio_callback_enabled=false\` and opt-in Preferences;
  no changes to Trakt's scrobble writer/canonical matching.
- \`AIOIINABridge-beta.app\` registers **only** \`aios-iina-beta://\`, not
  the production \`aios-iina://\` link.
- Python/Node regression tests; GitHub Actions macOS packaging and root tests.

Not yet qualified:
- EOF-to-Watched and x-error contract.
- Match reliability of IINA/MPV URL versus the exact SHA256 of AIO source
  under HLS variants.
- Asynchronous callback completion before actual window/process teardown,
  per-OS app routing behavior, Web tab reuse, or native Desktop return handling.
- Live Trakt echo / duplicate prevention. Keep \`finished=1\` **disabled**.

Do not merge or release as Stable until Mac canary verifies stop/resume and
all existing Trakt+ scrobble/matching behaviors.
