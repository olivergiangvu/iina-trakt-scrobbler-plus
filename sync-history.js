// Read-only audit of confirmed final Trakt syncs (not playback history).
// Bounded and redacted; never store stream URLs, tokens or API credentials.
var HISTORY_PATH = "@data/recent-final-syncs.json";
var MAX_RECORDS = 12;
var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function create(file, options) {
  var opts = options || {};
  var now = typeof opts.now === "function" ? opts.now : Date.now;
  var path = opts.path || HISTORY_PATH;

  function read() {
    try {
      var raw = file.exists(path) ? JSON.parse(file.read(path)) : [];
      if (!Array.isArray(raw)) return [];
      return raw.filter(function(item) {
        return item && typeof item.id === "string" &&
          Number.isFinite(item.syncedAt) && item.syncedAt <= now() + 60000 &&
          now() - item.syncedAt <= MAX_AGE_MS &&
          typeof item.label === "string" && item.label.length < 320;
      }).slice(0, MAX_RECORDS);
    } catch (_error) { return []; }
  }

  function sanitizeLabel(mediaInfo) {
    var media = mediaInfo || {};
    var title = String(media.type === "episode"
      ? (media.showTitle || media.title || "Episode")
      : (media.title || "Movie"));
    // Avoid control characters and accidentally embedded credential-bearing URLs.
    title = title.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 220);
    if (/^(?:https?:|magnet:)/i.test(title)) title = "Unknown media";
    if (media.type === "episode") {
      var season = Number(media.season), episode = Number(media.episode);
      if (Number.isInteger(season) && Number.isInteger(episode)) {
        title += " S" + String(season).padStart(2, "0") +
          "E" + String(episode).padStart(2, "0");
      }
    }
    return title;
  }

  function record(entry, outcome) {
    if (!entry || typeof entry.id !== "string") return false;
    var status = outcome === "duplicate" ? "confirmed_duplicate" : "confirmed";
    var item = {
      id: entry.id,
      label: sanitizeLabel(entry.mediaInfo),
      progress: Math.min(100, Math.max(0, Number(entry.progress) || 0)),
      status: status,
      syncedAt: now()
    };
    var updated = read().filter(function(x) { return x.id !== item.id; });
    updated.unshift(item);
    try {
      file.write(path, JSON.stringify(updated.slice(0, MAX_RECORDS)));
      return true;
    } catch (_error) { return false; }
  }
  return { recent: read, record: record };
}
module.exports = { create: create };
