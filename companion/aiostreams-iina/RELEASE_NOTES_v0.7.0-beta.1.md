# AIO-IINA Companion v0.7.0-beta.1 — Identity Context Canary

**Pre-release for macOS deployment and validation, not a production upgrade.**

## What's new
- Extends the **existing** AIOIINABridge.app (no second helper, new daemon, Trakt writer, HomeDocker stack or AIOStreams image).
- Retains the original working AIOStreams Custom Link format and playback/subtitle/resume behavior.
- Optional, **disabled-by-default** cross-catalog metadata lookup from an allowlisted HTTPS AIO Web return context: checks exact episode item and media-source IDs, parent series, S/E, year and IMDb/TMDb/TVDB ProviderIds with an authorized *user-scoped* Jellyfin session.
- Saves a short-lived (5 minutes), local, private (0700/0600) sanitized identity context with SHA-256 correlation to the exact media URL; never saves the URL or credentials.
- Never blocks the IINA launch when the identity lookup fails.

## What this release does NOT do
- No automatic metadata handoff into Trakt+ or Episode Info+ yet. The IINA consumer integration and a live authenticated /Items API test are separate release gates.
- Does not solve unknown title/TVDB alias discovery yet.
- Does not enable natural EOF→Watched, change Trakt history, or add any extra scrobbler.
- AIOStreams desktop `aiostreams://return` is not enabled for item identity in this first phase.

## Installation on Mac (side-by-side)
1. Download the attached ZIP and SHA256SUMS.txt. Validate checksum before opening.
2. Unzip and copy `AIOIINABridge-beta.app` into `~/Applications/`. Leave `AIOIINABridge.app` production untouched.
3. Beta registers only `aios-iina-beta://`, with a separate bundle ID. Your existing AIOStreams `aios-iina://play` URL must remain unchanged until you explicitly test the beta.
4. For an isolated beta trial, substitute the scheme only:
   `aios-iina-beta://play?url={encodedUrl}&title={title}&position={position}&sub={subtitles}&context={returnUrl}`
5. This pre-release is ad-hoc signed but **not Apple-notarized**. Review application provenance before any macOS security override. Use Finder Open / Privacy & Security controls if Gatekeeper requires approval; do not disable Gatekeeper globally.

## Optional identity lookup setup
The feature is **OFF** unless a private `~/Library/Application Support/AIO-IINA-Bridge/identity-settings.json` config explicitly enables a trusted HTTPS origin. See the repo [Companion README](https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/blob/feat/companion-identity-context-v07/companion/aiostreams-iina/README.md). An authorized user-scoped token must be provisioned **privately in macOS Keychain** under service `AIO-IINA-Identity-Token` and account equal to the allowed HTTPS origin; never paste a token into Custom Links, terminal chat, screenshots or logs.

## Verification and rollback
- Check player video, selected stream URL, subtitle VI>EN, and resume positions against the production Companion.
- Logs show only `AIO_IDENTITY_CONTEXT=created|not-created`, no URLs or API credentials.
- Identity sidecars are short-lived; a missing one is normal if opt-in remains disabled or metadata isn't accessible.
- Roll back instantly by restoring the **existing** `aios-iina://` Custom Link. No app/data migration is necessary.
- Details and API assumptions: [Draft PR #20](https://github.com/olivergiangvu/iina-trakt-scrobbler-plus/pull/20).

This is an early beta, separate from Trakt+ plugin version 0.2.9-beta.6 and Episode Info+ 1.3.4-beta.5.
