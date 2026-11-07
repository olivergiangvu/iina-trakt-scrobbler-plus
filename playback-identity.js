// Playback identity selection for IINA + mpv streams.
// Prefer readable player metadata over opaque stream URL path tokens.
var mediaFusion = require("./mediafusion-identity.js");
var aiosFragment = require("./aiostreams-fragment.js");

function isOpaque(value) {
  var text = String(value || "").trim();
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  // A generic HLS manifest is never proof of a film named "Index".
  if (/^(?:index|master|playlist|manifest)\.(?:m3u8|mpd)(?:[?#].*)?$/i.test(text)) return true;
  // DMM/mpv can report an opaque playback ID followed by ?h=...&file=...
  // as the "filename". Never parse that whole query into a show title.
  if (/[?&](?:h|hash|infohash|file|filename|torrent_name|token)=/i.test(text)) return true;
  if (/^eyJ[A-Za-z0-9_-]{20,}/.test(text)) return true;
  // Encoded streaming path token followed by a fabricated SxxExx marker.
  var prefix = text.split(/\s+S\d{1,2}E\d{1,4}\b/i)[0];
  if (/^[A-Za-z0-9_-]{20,}$/.test(prefix) && !/[ .]/.test(prefix)) return true;
  return false;
}

// IINA presents some HLS streams as "Show · S01E01 · Episode 1"
// while the real file is only index.m3u8. Convert ONLY this anchored,
// structured episode label; never infer an identity from an opaque URL.
function normalizeEpisodeMediaLabel(text) {
  var value = String(text || "").trim();
  var m = /^(.+?)\s+[·•]\s+(S\d{1,3}E\d{1,4})(?:\s+[·•]\s+(.+))?$/i.exec(value);
  if (!m) return value;
  return m[1].trim() + " " + m[2] + (m[3] ? " - " + m[3].trim() : "");
}

function identify(source, parser, streamSource) {
  var hints = source || {};
  var fragment = aiosFragment.inspect(hints);
  // If a fragment claims playback identity but is malformed, fail closed:
  // never let 'index.m3u8#aios_title=...' enter Guessit as a fabricated title.
  if (fragment.present && !fragment.valid) {
    return {parsed:null,imdb:"",source:"aiostreams-fragment-invalid"};
  }
  var urls = [hints.path, hints.url, hints.filename, hints.title, hints.mediaTitle].filter(Boolean);
  var stream = { name: "", imdb: "", nameSource: "" };
  var episodeRoute = mediaFusion.fromSource(hints);

  urls.forEach(function(value) {
    var entry = streamSource.extract(value, "");
    if (!stream.name && entry.name) {
      stream.name = entry.name;
      stream.nameSource = entry.nameSource;
    }
    if (!stream.imdb && entry.imdb) stream.imdb = entry.imdb;
  });

  if (fragment.valid) {
    // The hint is intentionally NOT sufficient to scrobble. Trakt applies
    // strict one-exact-show + exact S/E verification in resolveEpisodeIds().
    return {parsed:fragment.parsed,imdb:stream.imdb,
      source:"aiostreams-title-fragment",episodeRoute:episodeRoute};
  }
  // Prefer a verified readable media title. Opaque mpv labels containing
  // debrid query strings are ignored; stream-file then supplies the filename.
  var candidates = [
    ["mpv-metadata-title", hints.metadataTitle],
    ["mpv-filename", hints.filename],
    ["mpv-media-title", hints.mediaTitle],
    ["core-title", hints.title],
    ["stream-" + (stream.nameSource || "name"), stream.name],
  ];
  var seen = Object.create(null);
  var movie = null;

  for (var i = 0; i < candidates.length; i++) {
    var label = candidates[i][0];
    var name = String(candidates[i][1] || "").trim();
    if (!name || name.length > 500 || isOpaque(name) || seen[name]) continue;
    seen[name] = true;
    var normalizedName = normalizeEpisodeMediaLabel(name);
    var parsed = parser.parseMediaFromSource(normalizedName, normalizedName);
    if (!parsed) continue;
    if (parsed.kind === "episode" && parsed.season >= 0 && parsed.episode > 0 &&
        !isOpaque(parsed.showTitle)) {
      // A disagreeing filename and provider route must not be silently scrobbled.
      if (episodeRoute && (parsed.season !== episodeRoute.season ||
          parsed.episode !== episodeRoute.episode)) continue;
      parsed.parserSource = label;
      return { parsed: parsed, imdb: stream.imdb, source: label, episodeRoute: episodeRoute };
    }
    if (!movie && parsed.kind === "movie" && !isOpaque(parsed.title) &&
        // Avoid treating generic one-word playback labels as movie IDs.
        (parsed.year || /\.[A-Za-z0-9]{2,4}$/.test(name) || name.split(/\s+/).length >= 2)) {
      parsed.parserSource = label;
      movie = { parsed: parsed, imdb: stream.imdb, source: label };
    }
  }
  if (episodeRoute) {
    // An isolated localized title, e.g. "Strom ozvěny", is the *episode title*
    // for S02E08 and never reliable evidence of the show name.
    var rawEpisodeTitle = String(hints.metadataTitle || hints.mediaTitle || hints.title || "").trim();
    if (isOpaque(rawEpisodeTitle) || /\bS\d{1,3}E\d{1,4}\b/i.test(rawEpisodeTitle)) rawEpisodeTitle = "";
    var episodeTitle = rawEpisodeTitle || (movie && movie.parsed && movie.parsed.title
      ? movie.parsed.title : "");
    var parsedEpisode = {
      kind: "episode", showTitle: "Unknown Series",
      season: episodeRoute.season, episode: episodeRoute.episode,
      episodeTitle: episodeTitle, unresolvedShow: !stream.imdb,
      parserSource: "mediafusion-episode-route"
    };
    return {parsed:parsedEpisode, imdb:stream.imdb, source:"mediafusion-episode-route",
      episodeRoute:episodeRoute};
  }
  return movie || { parsed: null, imdb: stream.imdb, source: "unidentified" };
}

module.exports = { identify: identify, isOpaque: isOpaque };
