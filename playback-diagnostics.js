var mediaFusion = require("./mediafusion-identity.js");
// Shareable IINA playback diagnostics. Never include stream URLs, path tokens,
// auth headers, query values (except IDs), or bearer credentials.
function compact(value, max) {
  var v = String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (/^(https?|magnet):/i.test(v)) return "[URL redacted]";
  if (/(?:access_token|refresh_token|bearer\s|api[_-]?key|authorization=)/i.test(v)) return "[sensitive value redacted]";
  return v.slice(0, max || 220);
}
function safeURL(value) {
  var raw = String(value || "");
  var parts = raw.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?/i);
  if (!parts) return null;
  var pathname = parts[3] || "/";
  var tokens = pathname.split("/").filter(Boolean).slice(0, 18);
  var query = String(parts[4] || "").replace(/^\?/, "");
  var entries = query ? query.split("&").slice(0, 30).map(function(x) {
    var mark = x.indexOf("=");
    var key = mark < 0 ? x : x.slice(0, mark);
    var val = mark < 0 ? "" : x.slice(mark + 1);
    try { key = decodeURIComponent(key); } catch (_) {}
    try { val = decodeURIComponent(val); } catch (_) {}
    return [key, val];
  }) : [];
  var imdb = "";
  for (var i=0; i<entries.length; i++) {
    if (/^(media_id|imdb|imdb_id)$/i.test(entries[i][0]) && /^tt\d{6,10}$/i.test(entries[i][1])) {
      imdb = entries[i][1]; break;
    }
  }
  return {
    scheme: parts[1].toLowerCase(),
    host: parts[2].replace(/:\d+$/, "").toLowerCase(),
    pathShape: "/" + tokens.map(function(token) {
      try { token = decodeURIComponent(token); } catch (_) {}
      if (/^\d{1,4}$/.test(token)) return token;
      if (/^(?:streaming_provider|playback|torbox|realdebrid|debrid|mediafusion|stream|streams|video|file|files|resolve|api|v1|v2|m3u8)$/i.test(token)) return token;
      return "[redacted]";
    }).join("/"),
    queryKeys: entries.map(function(entry) { return compact(entry[0], 32); }),
    imdb: imdb
  };
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
    mediaFusionRoute: (function(){
      var route = mediaFusion.fromSource(s);
      return route ? {kind:"episode",season:route.season,episode:route.episode,
        provider:route.provider,seriesIdentityAvailable:!p.unresolvedShow} : null;
    })(),
    urlShapes: urls
  };
  return JSON.stringify(data, null, 2);
}
module.exports = { build: build, safeURL: safeURL };
