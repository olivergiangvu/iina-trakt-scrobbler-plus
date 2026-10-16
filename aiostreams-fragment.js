// Playback-only metadata provided by an AIOStreams Custom Link URL fragment.
// A fragment is a *hint*, not proof of identity. Trakt must independently
// resolve one exact show title and the exact episode before any scrobble.
// Never read tokens/query strings as a file/series name.
function inspect(source) {
  var src = source || {};
  var urls = [src.path, src.url];
  var found = [];
  for (var i = 0; i < urls.length; i++) {
    var url = String(urls[i] || "");
    var hash = url.indexOf("#");
    if (hash < 0) continue;
    var fragment = url.slice(hash + 1);
    var parts = fragment.split("&");
    for (var j = 0; j < parts.length; j++) {
      var equal = parts[j].indexOf("=");
      var rawKey = equal < 0 ? parts[j] : parts[j].slice(0, equal);
      var key = "";
      try { key = decodeURIComponent(rawKey).toLowerCase(); }
      catch (_error) { continue; }
      if (key !== "aios_title") continue;
      var value = equal < 0 ? "" : parts[j].slice(equal + 1);
      try { value = decodeURIComponent(value); }
      catch (_error) { return {present:true, valid:false,reason:"malformed-encoding"}; }
      found.push(value.trim());
    }
  }
  if (!found.length) return {present:false,valid:false};
  // mpv path and core.url often carry the *same* fragment. Only allow an
  // identical value to prevent inconsistencies from being silently accepted.
  var title = found[0];
  if (!title || title.length > 300 || /[\x00-\x1F\x7F]/.test(title) ||
      found.some(function(x){return x !== title;}))
    return {present:true,valid:false,reason:"missing-or-conflicting-title"};
  // AIOStreams' current fullTitle() emits: Show · S01E10 · Episode Title.
  // Do not parse 'index.m3u8' or infer a TV identity from a bare movie title.
  var match = /^(.+?)\s*·\s*S(\d{1,3})E(\d{1,4})(?:\s*·\s*(.+))?$/i.exec(title);
  if (!match) {
    // AIOStreams fullTitle() sends only the movie title. A local, readable
    // filename such as Poetic.Justice.1993.mkv supplies the production year.
    // A yearless HLS index.m3u8 is usable for display/manual correction, but
    // cannot be auto-scrobbled without independently verified year or ID.
    var movieTitle = title, declaredYear = null;
    var inlineYear = /^(.*?)\s+\(((?:19|20)\d{2})\)$/.exec(title);
    if (inlineYear) {
      movieTitle = inlineYear[1].trim();
      declaredYear = Number(inlineYear[2]);
    }
    if (!movieTitle || movieTitle.length > 200 ||
        /\bS\d{1,3}E\d{1,4}\b/i.test(movieTitle) ||
        /\s[·|]\s/.test(movieTitle) ||
        /^(?:index|master|playlist|manifest)(?:\.(?:m3u8|mpd))?$/i.test(movieTitle) ||
        /\.(?:m3u8|mpd|mkv|mp4|avi)$/i.test(movieTitle)) {
      return {present:true,valid:false,reason:"unsupported-title-format"};
    }
    var filename = String(src.filename || "").split("#")[0].split("?")[0];
    filename = filename.slice(filename.lastIndexOf("/") + 1);
    var movieFile = /^(.*?)\.?((?:19|20)\d{2})(?:[. _-]|\.(?:mkv|mp4|mov|avi)$|$)/i.exec(filename);
    function movieKey(str) {
      return String(str || "").toLowerCase().normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g," ").trim();
    }
    var matchingFileYear = movieFile && movieKey(movieFile[1]) === movieKey(movieTitle)
      ? Number(movieFile[2]) : null;
    if (declaredYear && matchingFileYear && declaredYear !== matchingFileYear)
      return {present:true,valid:false,reason:"conflicting-movie-year"};
    return {present:true,valid:true,parsed:{
      kind:"movie",title:movieTitle,year:declaredYear || matchingFileYear,
      parserSource:"aiostreams-title-fragment"
    }};
  }
  var show = match[1].trim(), season = Number(match[2]), episode = Number(match[3]);
  var episodeTitle = String(match[4] || "").trim();
  if (!show || show.length > 200 || /^(?:index|master|playlist|manifest)(?:\.m3u8)?$/i.test(show) ||
      !Number.isInteger(season) || season < 0 || season > 100 ||
      !Number.isInteger(episode) || episode < 1 || episode > 9999)
    return {present:true,valid:false,reason:"invalid-episode-position"};
  // Only treat a year as independent corroboration when a readable local
  // filename agrees with BOTH the show's base name and episode coordinates.
  // Never parse dates out of opaque stream URLs or access-token paths.
  var displayName = String(src.filename || "").split("#")[0].split("?")[0];
  displayName = displayName.slice(displayName.lastIndexOf("/") + 1);
  var fileMatch = /^(.+?)[. _-]+((?:19|20)\d{2})[. _-]+S(\d{1,3})E(\d{1,4})(?:[. _-]|$)/i.exec(displayName);
  var bareShow = show.replace(/\s+\((?:US|UK|AU|CA|NZ)\)$/i, "");
  function simplify(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  var year = fileMatch && simplify(fileMatch[1]) === simplify(bareShow) &&
    Number(fileMatch[3]) === season && Number(fileMatch[4]) === episode
    ? Number(fileMatch[2]) : null;
  return {present:true,valid:true,parsed:{
    kind:"episode",showTitle:show,season:season,episode:episode,
    year:year,episodeTitle:episodeTitle,unresolvedShow:false,
    parserSource:"aiostreams-title-fragment"
  }};
}
module.exports = {inspect:inspect};
