// Optional AIOStreams → IINA → AIO return integration.
// Does not contact Trakt or mutate AIO; old Trakt+ pipeline remains unchanged.
// Works in IINA JSCore (no Node crypto, fetch, or Buffer).
"use strict";

var K = ("428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 " +
  "d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 " +
  "e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da " +
  "983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 " +
  "27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 " +
  "a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 " +
  "19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 " +
  "748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2").split(" ")
  .map(function(hex) { return parseInt(hex, 16) | 0; });

function sha256(input) {
  if (typeof input !== "string") return "";
  var encoded = encodeURIComponent(input);
  var bytes = [];
  for (var j = 0; j < encoded.length; j++) {
    if (encoded[j] === "%") {
      bytes.push(parseInt(encoded.slice(j + 1, j + 3), 16));
      j += 2;
    } else {
      bytes.push(encoded.charCodeAt(j));
    }
  }
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  for (var shift = 24; shift >= 0; shift -= 8) bytes.push((hi >>> shift) & 255);
  for (var shift2 = 24; shift2 >= 0; shift2 -= 8) bytes.push((lo >>> shift2) & 255);
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  for (var off = 0; off < bytes.length; off += 64) {
    var w = Array(64);
    for (var a = 0; a < 16; a++) {
      var n = off + a * 4;
      w[a] = ((bytes[n] << 24) | (bytes[n+1] << 16) |
        (bytes[n+2] << 8) | bytes[n+3]) | 0;
    }
    for (a = 16; a < 64; a++) {
      var x = w[a-15], y = w[a-2];
      var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[a] = (w[a-16] + s0 + w[a-7] + s1) | 0;
    }
    var [aa,bb,cc,dd,ee,ff,gg,hh] = H;
    for (a = 0; a < 64; a++) {
      var big1 = rotr(ee,6) ^ rotr(ee,11) ^ rotr(ee,25);
      var choice = (ee & ff) ^ (~ee & gg);
      var t1 = (hh + big1 + choice + K[a] + w[a]) | 0;
      var big0 = rotr(aa,2) ^ rotr(aa,13) ^ rotr(aa,22);
      var majority = (aa & bb) ^ (aa & cc) ^ (bb & cc);
      var t2 = (big0 + majority) | 0;
      hh=gg; gg=ff; ff=ee; ee=(dd+t1)|0;
      dd=cc; cc=bb; bb=aa; aa=(t1+t2)|0;
    }
    var vals=[aa,bb,cc,dd,ee,ff,gg,hh];
    for (a=0;a<8;a++) H[a]=(H[a]+vals[a])|0;
  }
  return H.map(function(h){return (h>>>0).toString(16).padStart(8,"0");}).join("");
}

function createCompanionCallback(options) {
  var fs = options.file, utils = options.utils;
  var now = options.now || Date.now;
  var enabled = options.enabled || function() { return false; };
  var current = null;
  var lastPosition = 0;
  var lastDuration = 0;
  var attemptedAt = 0;
  var finished = false;
  var sessionDir = options.sessionDir ||
    utils.resolvePath("~/Library/Application Support/AIO-IINA-Bridge/sessions");

  function attach(paths) {
    if (!enabled() || current || finished || !Array.isArray(paths)) return false;
    if (now() - attemptedAt < 1000) return false;
    attemptedAt = now();
    var urls = paths.filter(function(x) {
      return typeof x === "string" && /^https?:\/\//i.test(x) && x.length < 24000;
    });
    if (!urls.length) return false;
    var hashes = urls.map(sha256);
    try {
      var listing = fs.list(sessionDir, { includeSubDir: false }) || [];
      var matches = [];
      for (var i = 0; i < Math.min(100, listing.length); i++) {
        var entry = listing[i], name = entry.filename || "";
        if (entry.isDir || !/^[0-9a-f]{32}\.json$/.test(name)) continue;
        var path = sessionDir + "/" + name;
        var json = fs.read(path);
        if (typeof json !== "string" || json.length > 8192) continue;
        var record = JSON.parse(json);
        if (record.schema !== 1 || record.session !== name.slice(0,32) ||
            hashes.indexOf(record.url_sha256) < 0 ||
            !Number.isFinite(record.issued_at_ms) || !Number.isFinite(record.expires_at_ms) ||
            now() < record.issued_at_ms || now() > record.expires_at_ms) continue;
        matches.push({ id: record.session, when: record.issued_at_ms });
      }
      matches.sort(function(a,b) { return b.when - a.when; });
      if (!matches.length) return false;
      current = matches[0].id;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function onLoaded(paths) {
    current = null; lastPosition = 0; lastDuration = 0;
    finished = false; attemptedAt = 0;
    return attach(paths);
  }

  function onPosition(position, duration, paths) {
    if (!enabled() || finished) return;
    if (!current && paths) attach(paths);
    var p = Number(position), d = Number(duration);
    if (Number.isFinite(d) && d > 0) lastDuration = d;
    if (Number.isFinite(p) && p >= 1 && p <= 604800) lastPosition = p;
  }

  function helperPath() {
    var candidates = options.helperPaths || [
      utils.resolvePath("~/Applications/AIOIINABridge-beta.app/Contents/Resources/callback_session.py"),
      "/Applications/AIOIINABridge-beta.app/Contents/Resources/callback_session.py",
      "/Applications/AIOIINABridge.app/Contents/Resources/callback_session.py",
      utils.resolvePath("~/Applications/AIOIINABridge.app/Contents/Resources/callback_session.py")
    ];
    return candidates.find(function(p) {
      return typeof p === "string" && utils.fileInPath(p);
    }) || null;
  }

  // Only a terminal close calls the macOS helper. end-file on media switch is
  // not a trusted EOF signal, so do not auto-mark Watched or open AIO there.
  async function onClose(position, duration, paths) {
    if (!enabled() || finished) return false;
    onPosition(position, duration, paths);
    if (!current || lastPosition < 1) return false;
    var helper = helperPath();
    if (!helper) return false; // no launch/side effect without a matching app
    finished = true;
    var pos = Math.floor(lastPosition);
    var id = current;
    current = null;
    try {
      var result = await utils.exec("/usr/bin/python3",
        [helper, "--complete", id, "--position", String(pos)]);
      return !!(result && result.status === 0);
    } catch (_err) {
      return false;
    }
  }

  function onMediaReplaced() { current = null; lastPosition = 0; lastDuration = 0; finished = false; attemptedAt = 0; }

  return {
    attach: attach, onLoaded: onLoaded, onPosition: onPosition,
    onClose: onClose, onMediaReplaced: onMediaReplaced,
    currentSession: function() { return current; },
    lastPosition: function() { return lastPosition; }
  };
}

module.exports = {sha256: sha256, createCompanionCallback: createCompanionCallback};
