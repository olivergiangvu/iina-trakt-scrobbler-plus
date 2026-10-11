// Shared API gate for this IINA process only. HomeDocker's bridge has its own broker.
var STORAGE = "@data/trakt-api-cooldown.json";
function create(options) {
  var o = options || {};
  var file = o.file;
  var now = o.now || Date.now;
  var wait = o.wait || function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  var WRITE_GAP = o.writeGapMs || 1350;
  var nextWriteAt = 0, queuedWrites = 0, lastRequestAt = 0, lastSuccessAt = 0;
  var cooldownUntil = 0, rateFailures = 0, offlineUntil = 0;
  var lastFailure = "", lastFailureAt = 0, lastStatus = 0, writeLane = Promise.resolve();
  try {
    var saved = file && file.exists(STORAGE) ? JSON.parse(file.read(STORAGE)) : {};
    if (Number.isFinite(saved.until) && saved.until > now() && saved.until < now() + 16 * 60 * 1000) {
      cooldownUntil = saved.until;
      rateFailures = Math.min(5, Math.max(0, Number(saved.failures) || 0));
      lastFailure = "rate_limited";
    }
  } catch (_error) {}

  function persist() {
    if (!file) return;
    try { file.write(STORAGE, JSON.stringify({until: cooldownUntil, failures: rateFailures})); } catch (_error) {}
  }
  function secondsUntil(time) { return Math.max(0, Math.ceil((time - now()) / 1000)); }
  function status() {
    var mode = cooldownUntil > now() ? "rate_limited" : offlineUntil > now() ? "offline" : "online";
    return {
      mode: mode, retryInSeconds: secondsUntil(mode === "rate_limited" ? cooldownUntil : offlineUntil),
      retryAt: mode === "rate_limited" ? new Date(cooldownUntil).toISOString() : "",
      queuedWrites: queuedWrites, lastFailure: lastFailure, lastFailureAt: lastFailureAt
        ? new Date(lastFailureAt).toISOString() : "", lastHttpStatus: lastStatus,
      lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : "",
      lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : ""
    };
  }
  function blockedError() {
    var s = status(), err = new Error(s.mode === "rate_limited"
      ? "Trakt rate limited. Retry in " + s.retryInSeconds + "s."
      : "Trakt temporarily unreachable. Retry in " + s.retryInSeconds + "s.");
    err.code = s.mode === "rate_limited" ? "TRAKT_COOLDOWN" : "TRAKT_OFFLINE";
    err.retryInSeconds = s.retryInSeconds;
    return err;
  }
  function retryAfterMs(value) {
    var raw = String(value || "").trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Math.min(900000, Number(raw) * 1000);
    var date = Date.parse(raw);
    return Number.isFinite(date) ? Math.min(900000, Math.max(0, date - now())) : 0;
  }
  function isCloudflare1015(response) {
    if (!response || response.statusCode !== 403 && response.statusCode !== 429) return false;
    var text = String(response.rawBody || "");
    return /(?:error\s*(?:code)?\s*[:#]?\s*1015|you are being rate limited)/i.test(text);
  }
  function classify(response) {
    if (isCloudflare1015(response)) return "cloudflare_1015";
    if (response && response.statusCode === 429) return "http_429";
    return "";
  }
  function recordRateLimit(response, reason) {
    rateFailures = Math.min(6, rateFailures + 1);
    var initial = reason === "cloudflare_1015" ? 120000 : 30000;
    var exponential = Math.min(900000, initial * Math.pow(2, rateFailures - 1));
    var suggested = retryAfterMs(response.headers && response.headers["retry-after"]);
    cooldownUntil = Math.max(cooldownUntil, now() + Math.max(exponential, suggested));
    offlineUntil = 0;
    lastFailure = reason;
    lastFailureAt = now();
    lastStatus = Number(response.statusCode || 0);
    persist();
    var err = blockedError();
    err.reason = reason;
    err.statusCode = lastStatus;
    return err;
  }
  function success() {
    lastSuccessAt = now();
    lastFailure = "";
    offlineUntil = 0;
    if (cooldownUntil <= now()) { cooldownUntil = 0; rateFailures = 0; persist(); }
  }
  async function runOperation(method, send) {
    if (cooldownUntil > now() || offlineUntil > now()) throw blockedError();
    var write = method !== "GET" && method !== "HEAD";
    if (write && nextWriteAt > now()) await wait(nextWriteAt - now());
    if (cooldownUntil > now() || offlineUntil > now()) throw blockedError();
    if (write) nextWriteAt = now() + WRITE_GAP;
    lastRequestAt = now();
    var response;
    try { response = await send(); }
    catch (error) {
      if (error && (error.code === "TRAKT_COOLDOWN" || error.code === "TRAKT_OFFLINE")) throw error;
      lastFailure = "network";
      lastFailureAt = now();
      offlineUntil = Math.max(offlineUntil, now() + 15000);
      throw error;
    }
    lastStatus = Number(response.statusCode || 0);
    var reason = classify(response);
    if (reason) throw recordRateLimit(response, reason);
    if (lastStatus >= 200 && lastStatus < 400) success();
    else if (lastStatus >= 500) {
      lastFailure = "server_error";
      lastFailureAt = now();
      offlineUntil = now() + 15000;
    }
    return response;
  }
  function request(method, send) {
    var kind = String(method || "GET").toUpperCase();
    if (kind === "GET" || kind === "HEAD") return runOperation(kind, send);
    queuedWrites++;
    var task = writeLane.then(function() { return runOperation(kind, send); });
    writeLane = task.then(function() { queuedWrites--; }, function() { queuedWrites--; });
    return task;
  }
  return { request: request, status: status, classify: classify };
}
module.exports = { create: create };
