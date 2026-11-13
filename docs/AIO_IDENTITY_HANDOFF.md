# AIOStreams → IINA verified identity: canary gates

Status: DRAFT / NOT DEPLOYED. Stable Trakt+ v0.2.9, EP+ v1.3.5 and Companion v0.5.1 remain unchanged on Mac.

## Provenance levels

1. Strong for THIS playback: enabled authenticated AIO Companion sidecar + SHA-256 of exact signed media URL + 5-minute TTL + exact configured HTTPS origin + independent provider ID/premiere-year/S-E validation. New CDN or URL token requires a NEW authenticated sidecar.
2. Limited/host-scoped: after explicit user Correct Match or EP+ manual selection, persist canonical title, premiere year, IMDb/TMDb/Trakt references, origin hostname and provenance; independently reverify every subsequent S/E. CDN hostname alone NEVER proves identical series and cannot authorize cross-host reuse.
3. Unknown: only display title and opaque HLS URL (such as Fired Up! S01E04, which collides for 1997 and 2026). Without reliable IDs or show year, fail closed. Never infer show premiere year from current date.

## Components

- Companion PR #21 on PR #20: beta v0.7.3 single-app candidate with existing aios-iina:// scheme, optional read-only authenticated GET of selected AIO item, parent show ProviderIds and PlaybackInfo source; emits private 0600 identity JSON under ~/Library/Application Support/AIO-IINA-Bridge/identity/. Disabled by default. Launches IINA *before* optional lookup. Does not run a daemon or write to Trakt.
- Trakt+ PR #24: read-only descriptor reader, independent IMDb/TMDb → Trakt show/year/episode validation, 2s/5s post-launch retry, exact S/E cache revalidation, signed HiTV filename diagnostics redaction. Remains ONLY Trakt writer.
- EP+ PR #19: read-only descriptor reader, independent TMDb/IMDb/year/exact S-E/runtime and TVmaze year/IMDb fallback, 2s/5s retry; retains v1.3.5 Now Playing and all existing features.

## Actual Mac opt-in prerequisites

1. Companion PR #21 Mac CI builds and passes; keep exactly ONE active AIOIINABridge.app and unchanged AIOStreams Custom Link. No side-by-side beta app and no Docker changes.
2. **Unverified production dependency:** confirm the actual AIOStreams origin supports authenticated Jellyfin-compatible /Items and /PlaybackInfo GET endpoints using a user-scoped token. If absent, the producer cannot emit a descriptor and this route cannot auto-match. Do not replace with title guesses.
3. Private config at ~/Library/Application Support/AIO-IINA-Bridge/identity-settings.json, chmod 0600: JSON object with enabled=true and exact HTTPS origin. Token belongs only to macOS Keychain service AIO-IINA-Identity-Token, account exact origin; NEVER paste credentials in logs or commit them.
4. Confirm emitted 0600 sidecar has ID/year/provenance/hash/issued/expiry but contains NO signed stream URL, sign, hmac, returnUrl or token.
5. Install GitHub Actions canary plugin packages only after Mac rollback plan, then smoke test. Existing stable cannot be silently promoted.

## Acceptance matrix

- Fired Up! 2026 S01E04: both plugins bind IMDb/TMDb/Trakt or independently TVmaze to 2026, exact episode; 1997 duplicate rejected.
- Later S01E05: new episode independently verified, no blanket approval from S01E04.
- CDN host/signature change without fresh descriptor: no cross-CDN auto-match; with new authenticated descriptor: match after provider recheck.
- Descriptor absent, late, expired, disabled, conflicting ID/year/position: fail closed without affecting playback; bounded retry for late descriptor.
- EP+ native Now Playing artwork, manual lookup, subtitles and overlays unaffected.
- Trakt+ Resume Protection, checkpoint journal and sole Trakt writer unaffected.
- Copy Diagnostics never shows HiTV sign/_hmac/hdnts/cp values.

Promotion gate: BOTH CI and hands-on IINA/Companion Mac field tests. No merge, new Stable, Companion replacement or HomeDocker changes solely on unit tests.

Related: https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/pull/21 ; https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/pull/24 ; https://github.com/olivergiangvu/iina-episode-info-plus/pull/19 .
