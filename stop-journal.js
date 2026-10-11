// Durable, identity-validated final-stop queue.
// Legacy v0.2.4 entries without proof remain visible in Needs Review,
// but are NEVER automatically replayed or deleted.
var DEFAULT_PATH = "@data/pending-final-scrobbles.json";
var MAX_ENTRIES = 20;
var MAX_AGE_MS = 48 * 60 * 60 * 1000;

function create(file, options) {
  var opts = options || {};
  var path = opts.path || DEFAULT_PATH;
  var now = typeof opts.now === "function" ? opts.now : Date.now;
  var random = typeof opts.random === "function" ? opts.random : Math.random;
  function usableMedia(m) {
    if (!m || !["movie", "episode"].includes(m.type) || m.unresolvedShow) return false;
    if (m.type === "movie") return !!String(m.title || "").trim() &&
      !/^(unknown|unknown movie|unknown media)$/i.test(String(m.title).trim());
    return !!String(m.showTitle || "").trim() &&
      !/^(unknown series|unknown show|unknown)$/i.test(String(m.showTitle).trim()) &&
      Number.isInteger(Number(m.season)) && Number(m.season) >= 0 &&
      Number.isInteger(Number(m.episode)) && Number(m.episode) > 0;
  }
  function goodProof(proof, m) {
    if (!proof || !usableMedia(m)) return false;
    if (proof.kind === "imdb") return /^tt\d{6,10}$/i.test(String(proof.imdb || m.imdb || ""));
    if (proof.kind === "manual" || proof.kind === "trakt-confirmed") {
      return Number.isInteger(Number(proof.traktId)) && Number(proof.traktId) > 0;
    }
    return false;
  }
  function valid(entry) {
    return entry && typeof entry.id === "string" &&
      entry.id.length > 0 && entry.id.length < 128 &&
      entry.mediaInfo && ["movie", "episode"].includes(entry.mediaInfo.type) &&
      typeof entry.progress === "number" && Number.isFinite(entry.progress) &&
      entry.progress >= 1 && entry.progress <= 100 &&
      Number.isFinite(entry.createdAt) && entry.createdAt <= now() + 60000 &&
      now() - entry.createdAt <= MAX_AGE_MS;
  }
  function keyFor(media) {
    var name = String(media.imdb || media.showTitle || media.title || "").trim().toLowerCase();
    return media.type === "episode" ?
      "episode|" + name + "|" + media.season + "|" + media.episode :
      "movie|" + name + "|" + (media.year || 0);
  }
  function isReplayable(entry) {
    // Presence of an old manualTraktId alone is not proof; v2 proof is explicit.
    return !!entry && goodProof(entry.replayProof, entry.mediaInfo);
  }
  function normalize(entries) {
    var seen = Object.create(null), out = [];
    for (var i = entries.length - 1; i >= 0; i--) {
      var entry = entries[i], key = keyFor(entry.mediaInfo);
      // Never replace a valid checkpoint with an unsafe one for the same item.
      if (seen[key]) {
        // Prefer a previously verified stop to newer unverifiable legacy data.
        var existing=out.findIndex(function(x){return keyFor(x.mediaInfo)===key;});
        if (existing>=0 && !isReplayable(out[existing]) && isReplayable(entry))
          out[existing]=entry;
        continue;
      }
      seen[key] = true;
      out.unshift(entry);
    }
    return out.slice(-MAX_ENTRIES);
  }
  function load() {
    try {
      var raw = file.exists(path) ? JSON.parse(file.read(path)) : [];
      return Array.isArray(raw) ? normalize(raw.filter(valid)) : [];
    } catch (_) { return []; }
  }
  function save(entries) {
    try {
      file.write(path, JSON.stringify(normalize(entries).slice(-MAX_ENTRIES), null, 2));
      return true;
    } catch (_) { return false; }
  }
  function copy(entry) { return JSON.parse(JSON.stringify(entry)); }
  function pending() { return load().filter(isReplayable).map(copy); }
  function review() { return load().filter(function(x){return !isReplayable(x);}).map(copy); }
  function find(id) { var entry = load().find(function(x) {return x.id === id;}); return entry ? copy(entry) : null; }
  function record(snapshot, proof) {
    var progress = Number(snapshot && snapshot.progress), media = snapshot && snapshot.mediaInfo;
    if (!Number.isFinite(progress) || progress < 1 || progress > 100 ||
        !goodProof(proof, media)) return null;
    var safeMedia = {
      type: media.type, title: String(media.title || "").slice(0, 256)
    };
    if (media.type === "episode") {
      safeMedia.showTitle = String(media.showTitle || "").slice(0, 256);
      safeMedia.season = Number(media.season);
      safeMedia.episode = Number(media.episode);
      safeMedia.episodeTitle = String(media.episodeTitle || "").slice(0, 256);
    }
    if (media.year) safeMedia.year = Number(media.year);
    if (/^tt\d{6,10}$/i.test(String(media.imdb || ""))) safeMedia.imdb = String(media.imdb).toLowerCase();
    var safeProof = proof.kind === "imdb"
      ? {kind:"imdb",imdb:String(proof.imdb || media.imdb).toLowerCase()}
      : {kind:proof.kind,traktId:Number(proof.traktId)};
    var rec = {
      id:String(now())+"-"+String(Math.floor(random()*1e9)),
      createdAt:now(), progress:progress, mediaInfo:safeMedia, replayProof:safeProof
    };
    var items = load(), key = keyFor(safeMedia);
    // Latest trusted stop supersedes an older legacy/unverified stop of this identity.
    items = items.filter(function(x){return keyFor(x.mediaInfo)!==key;});
    items.push(rec);
    return save(items) ? copy(rec) : null;
  }
  function acknowledge(id) {
    return !!id && save(load().filter(function(x){return x.id !== id;}));
  }
  function markReview(id, reason) {
    var items=load(), found=false;
    items.forEach(function(x) {
      if (x.id!==id || !isReplayable(x)) return;
      x.replayProof=null;
      x.reviewReason=String(reason||"Trakt could not verify identity").slice(0,100);
      found=true;
    });
    return found && save(items);
  }
  function discardReview(id) {
    var original = find(id);
    if (!original || isReplayable(original)) return false;
    return save(load().filter(function(x){return x.id !== id;}));
  }
  return {
    pending:pending, review:review, find:find, record:record,
    acknowledge:acknowledge, discardReview:discardReview, markReview:markReview,
    isReplayable:isReplayable
  };
}
module.exports={create:create};