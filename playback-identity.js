// Playback identity selection for IINA + mpv streams.
// Prefer readable player metadata over opaque stream URL path tokens.
function isOpaque(value) {
  var text = String(value || "").trim();
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^eyJ[A-Za-z0-9_-]{20,}/.test(text)) return true;
  // Encoded streaming path token followed by a fabricated SxxExx marker.
  var prefix = text.split(/\s+S\d{1,2}E\d{1,4}\b/i)[0];
  if (/^[A-Za-z0-9_-]{20,}$/.test(prefix) && !/[ .]/.test(prefix)) return true;
  return false;
}

function identify(source, parser, streamSource) {
  var hints = source || {};
  var urls = [hints.path, hints.url, hints.title, hints.mediaTitle].filter(Boolean);
  var stream = { name: "", imdb: "", nameSource: "" };

  urls.forEach(function(value) {
    var entry = streamSource.extract(value, "");
    if (!stream.name && entry.name) {
      stream.name = entry.name;
      stream.nameSource = entry.nameSource;
    }
    if (!stream.imdb && entry.imdb) stream.imdb = entry.imdb;
  });

  // mpv metadata title and filename are the same hints used successfully
  // by other IINA integrations. Prefer them over encoded playback paths.
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
    var parsed = parser.parseMediaFromSource(name, name);
    if (!parsed) continue;
    if (parsed.kind === "episode" && parsed.season >= 0 && parsed.episode > 0 &&
        !isOpaque(parsed.showTitle)) {
      parsed.parserSource = label;
      return { parsed: parsed, imdb: stream.imdb, source: label };
    }
    if (!movie && parsed.kind === "movie" && !isOpaque(parsed.title) &&
        // Avoid treating generic one-word playback labels as movie IDs.
        (parsed.year || /\.[A-Za-z0-9]{2,4}$/.test(name) || name.split(/\s+/).length >= 2)) {
      parsed.parserSource = label;
      movie = { parsed: parsed, imdb: stream.imdb, source: label };
    }
  }
  return movie || { parsed: null, imdb: stream.imdb, source: "unidentified" };
}

module.exports = { identify: identify, isOpaque: isOpaque };
