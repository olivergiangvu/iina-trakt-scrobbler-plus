// Durable final Trakt scrobble queue.
// Store only normalized item identity and percentage (never media URLs/tokens).
var DEFAULT_PATH = "@data/pending-final-scrobbles.json";
var MAX_ENTRIES = 20;
var MAX_AGE_MS = 48 * 60 * 60 * 1000;

function create(file, options) {
  var settings = options || {};
  var path = settings.path || DEFAULT_PATH;
  var now = typeof settings.now === "function" ? settings.now : Date.now;
  var random = typeof settings.random === "function" ? settings.random : Math.random;
  function valid(entry) {
    return entry && typeof entry.id === "string" &&
      entry.mediaInfo && ["movie", "episode"].includes(entry.mediaInfo.type) &&
      typeof entry.progress === "number" && Number.isFinite(entry.progress) &&
      entry.progress >= 1 && entry.progress <= 100 &&
      Number.isFinite(entry.createdAt) && entry.createdAt <= now() + 60000 &&
      now() - entry.createdAt <= MAX_AGE_MS;
  }
  function mediaKey(media) {
    var id = String(media.imdb || media.showTitle || media.title || "").trim().toLowerCase();
    return media.type === "episode"
      ? "episode|" + id + "|" + Number(media.season) + "|" + Number(media.episode)
      : "movie|" + id + "|" + Number(media.year || 0);
  }
  function latestOnly(entries) {
    var seen = Object.create(null), result = [];
    for (var i = entries.length - 1; i >= 0; i--) {
      var key = mediaKey(entries[i].mediaInfo);
      if (seen[key]) continue;
      seen[key] = true;
      result.unshift(entries[i]);
    }
    return result.slice(-MAX_ENTRIES);
  }
  function load() {
    try {
      var saved = file.exists(path) ? JSON.parse(file.read(path)) : [];
      return Array.isArray(saved) ? latestOnly(saved.filter(valid)) : [];
    } catch (_error) { return []; }
  }
  function save(entries) {
    try {
      file.write(path, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2));
      return true;
    } catch (_error) { return false; }
  }
  function pending() {
    return load().map(function(entry) {
      return JSON.parse(JSON.stringify(entry));
    });
  }
  function record(snapshot) {
    var progress = Number(snapshot && snapshot.progress);
    var media = snapshot && snapshot.mediaInfo;
    if (!Number.isFinite(progress) || progress < 1 || progress > 100 ||
        !media || !["episode", "movie"].includes(media.type)) return null;
    var id = String(now()) + "-" + String(Math.floor(random() * 1e9));
    var safeMedia = { type: media.type, title: String(media.title || "").slice(0, 256) };
    if (media.type === "episode") {
      safeMedia.showTitle = String(media.showTitle || "").slice(0, 256);
      safeMedia.season = Number(media.season);
      safeMedia.episode = Number(media.episode);
      safeMedia.episodeTitle = String(media.episodeTitle || "").slice(0, 256);
    }
    if (media.year) safeMedia.year = Number(media.year);
    if (/^tt\d{6,10}$/i.test(String(media.imdb || ""))) safeMedia.imdb = media.imdb.toLowerCase();
    var data = {
      id: id,
      createdAt: now(),
      progress: progress,
      mediaInfo: safeMedia
    };
    var queue = load();
    queue.push(data);
    // Latest stop for the same item wins, avoiding stale resume overwrites
    // and unnecessary Trakt writes after an outage.
    return save(latestOnly(queue)) ? data : null;
  }
  function acknowledge(id) {
    if (!id) return false;
    return save(load().filter(function(entry) { return entry.id !== id; }));
  }
  return { pending: pending, record: record, acknowledge: acknowledge };
}
module.exports = { create: create };
