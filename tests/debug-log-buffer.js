const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {create} = require("../debug-log-buffer.js");

const files = Object.create(null);
const counts = {reads: 0, writes: 0};
let failNext = false;
const io = {
  exists(p) { return Object.hasOwn(files, p); },
  read(p) { counts.reads++; return files[p]; },
  write(p, content) {
    counts.writes++;
    if (failNext) { failNext = false; throw Error("temporary disk failure"); }
    files[p] = content;
  }
};
const p = "@data/debug.log";
const buffer = create(io, {path:p, maxChars:1024, thresholdChars:256});
for (let i = 0; i < 30; i++) buffer.append("marker-" + i);
assert.ok(counts.writes > 0 && counts.writes < 30, "batch logging must reduce full-file writes");
assert.equal(buffer.flush(), true);
assert.equal(buffer.pendingChars(), 0);
assert.ok(files[p].includes("marker-29"), "last entry retained");
assert.ok(files[p].length <= 1024, "persistent log size bounded");
assert.ok(!files[p].includes("marker-0"), "old entries evicted on rollover");

const writesBefore = counts.writes;
for (let i = 0; i < 3; i++) buffer.append("quiet-" + i);
assert.equal(counts.writes, writesBefore, "small pending batch must not rewrite file immediately");
assert.ok(buffer.pendingChars() > 0);
buffer.flush(); // timer or window close invokes this even below batch threshold
assert.ok(files[p].includes("quiet-2"), "teardown flush persists final events");

const retry = create(io, {path:p, maxChars:1024, thresholdChars:512});
failNext = true;
retry.append("DO-NOT-LOSE-ON-ERROR");
assert.equal(retry.flush(), false);
assert.ok(retry.pendingChars() > 0, "failed write must retain unsaved diagnostics");
assert.equal(retry.flush(), true);
assert.equal(retry.pendingChars(), 0);
assert.ok(files[p].includes("DO-NOT-LOSE-ON-ERROR"));

const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
assert.match(source, /debugLog\.flush\(\);\s*var traktFinal = Promise\.resolve\(finalizeCurrentMedia\("window-will-close"\)\)/,
  "force synchronous diagnostic flush before window teardown");
assert.match(source, /return Promise\.allSettled\(\[aioReturn, traktFinal\]\)/,
  "callback and Trakt finalization must settle independently before teardown");
assert.match(source, /debugLog\.flush\(\);\s*return Promise\.resolve\(finalizeCurrentMedia\("mpv.shutdown"\)\)/,
  "force synchronous diagnostic flush before mpv teardown");
console.log("Batched debug log bounded write, rollover, retry, teardown tests PASS");
