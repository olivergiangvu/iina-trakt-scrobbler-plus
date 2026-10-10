// Stream URL identity extractor for Remux, AIOStreams, Stremio and debrid links.
// Uses only locally available playback metadata; never requests or downloads streams.
// Based on the approach of iina-episode-info (MIT), with a separate implementation.

function decodeQueryValue(value) {
  var result = String(value || "").replace(/\+/g, " ");
  for (var i = 0; i < 2 && /%[0-9a-f]{2}/i.test(result); i++) {
    try { result = decodeURIComponent(result); } catch (_error) { break; }
  }
  return result;
}

function queryValue(text, key) {
  var input = String(text || "");
  var expression = new RegExp("[?&]" + key + "=([^&#]*)", "i");
  var match = input.match(expression);
  return match ? decodeQueryValue(match[1]).trim() : "";
}

function usableFilename(value) {
  var name = String(value || "").trim();
  if (!name || name.length > 500) return "";
  if (/^(?:https?:\/\/|magnet:)/i.test(name)) return "";
  if (/^eyJ[A-Za-z0-9_-]{30,}/.test(name)) return "";
  return name;
}

function getImdbId(text) {
  var value = String(text || "").trim();
  return /^tt\d{6,10}$/i.test(value) ? value.toLowerCase() : "";
}

function extract(url, title) {
  var sources = [String(url || ""), String(title || "")];
  var names = ["torrent_name", "filename", "file", "fn", "name"];
  var idKeys = ["media_id", "imdb", "imdb_id", "imdbid"];
  var name = "", imdb = "", nameSource = "";

  for (var i = 0; i < sources.length; i++) {
    for (var j = 0; j < names.length && !name; j++) {
      var candidate = usableFilename(queryValue(sources[i], names[j]));
      if (candidate) {
        name = candidate;
        nameSource = names[j];
      }
    }
    for (var k = 0; k < idKeys.length && !imdb; k++) {
      imdb = getImdbId(queryValue(sources[i], idKeys[k]));
    }
  }

  return { name: name, imdb: imdb, nameSource: nameSource };
}

module.exports = { extract: extract };
