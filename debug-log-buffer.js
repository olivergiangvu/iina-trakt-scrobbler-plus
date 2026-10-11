// Bounded, batched diagnostic file writer for the IINA plugin runtime.
// Console logging stays immediate; the on-disk debug log is advisory only.
// No timer here: the host calls flush on a cadence and on window teardown.
function create(file, options) {
  var opts = options || {};
  var path = opts.path || "@data/debug.log";
  var maxChars = Math.max(1024, Number(opts.maxChars) || 200000);
  var thresholdChars = Math.min(maxChars, Math.max(128, Number(opts.thresholdChars) || 8192));
  var pending = "";
  function append(message) {
    var line = "[" + new Date().toISOString() + "] " + String(message) + "\n";
    pending += line;
    if (pending.length > maxChars) pending = pending.slice(-maxChars);
    if (pending.length >= thresholdChars) flush();
  }
  function flush() {
    if (!pending) return true;
    try {
      var existing = file.exists(path) ? String(file.read(path) || "") : "";
      var next = (existing + pending).slice(-maxChars);
      file.write(path, next);
      pending = "";
      return true;
    } catch (_error) {
      // Keep pending diagnostics in memory for the next attempt. Never
      // let an optional diagnostic write interrupt playback or scrobbling.
      return false;
    }
  }
  return {
    append: append,
    flush: flush,
    pendingChars: function () { return pending.length; }
  };
}

module.exports = { create: create };
