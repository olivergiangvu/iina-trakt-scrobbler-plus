// Shareable IINA playback diagnostics. Never include stream URLs, path tokens,
// auth headers, query values (except IDs), or bearer credentials.
function compact(value, max) {
  var v = String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (/^(https?|magnet):/i.test(v)) return "[URL redacted]";
  if (/(?:access_token|refresh_token|bearer\s|api[_-]?key|authorization=)/i.test(v)) return "[sensitive value redacted]";
  return v.slice(0, max || 220);
}
function safeURL(value) {
  if (!/^https?:\/\//i.test(String(value || ""))) return null;
  try {
    var parsed = new URL(value);
    var segments = parsed.pathname.split("/").filter(Boolean).slice(0, 18);
    return {
      scheme: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      pathShape: "/" + segments.map(function(p) {
        try { p = decodeURIComponent(p); } catch (_) {}
        if (/^\d{1,4}$/.test(p)) return p;
        if (/^(?:streaming_provider|playback|torbox|realdebrid|debrid|mediafusion|stream|streams|video|file|files|resolve|api|v1|v2|m3u8)$/i.test(p)) return p;
        return "[redacted]";
      }).join("/"),
      queryKeys: Array.from(parsed.searchParams.keys()).slice(0, 30).map(function(k) {
        return compact(k, 32);
      }),
      imdb: ["media_id","imdb","imdb_id"].map(k=>parsed.searchParams.get(k)).find(v=>/^tt\d{6,10}$/i.test(v || "")) || ""
    };
  } catch (_) { return {format: "url", error: "parse failed"}; }
}
function build(source, parsed, target, version) {
  var s = source || {}, p = parsed || {}, urls = [];
  ["url", "path", "mediaTitle", "title"].forEach(function(key) {
    var safe = safeURL(s[key]);
    if (safe && !urls.some(u=>u.host===safe.host && u.pathShape===safe.pathShape && String(u.queryKeys)===String(safe.queryKeys))) {
      urls.push(safe);
    }
  });
  var data = {
    pluginVersion: compact(version || "unknown",32),
    player: {
      title: compact(s.title),
      filename: compact(s.filename),
      mediaTitle: compact(s.mediaTitle),
      metadataTitle: compact(s.metadataTitle)
    },
    recognized: {
      kind: compact(p.kind, 16),
      title: compact(p.title || p.showTitle),
      season: Number.isInteger(p.season) ? p.season : null,
      episode: Number.isInteger(p.episode) ? p.episode : null,
      source: compact(p.parserSource, 48)
    },
    traktTarget: compact(target || ""),
    urlShapes: urls
  };
  return JSON.stringify(data, null, 2);
}
module.exports = { build: build, safeURL: safeURL };
