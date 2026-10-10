const assert = require("node:assert/strict");
const journal = require("../stop-journal.js");
const store = {};
const file = {
  exists(p) { return Object.hasOwn(store, p); },
  read(p) { return store[p]; },
  write(p,v) { store[p] = v; }
};
let time = 10000000;
const q = journal.create(file, {now: () => time, random: () => 0.5});
const saved = q.record({ progress: 48.02,
 mediaInfo: { type: "episode", showTitle: "The Legend of Vox Machina", title: "The Legend of Vox Machina",
 season: 2, episode: 6, imdb: "tt11247158", sourceUrl: "https://s.example/?token=never-save" } });
assert.ok(saved);
assert.equal(q.pending().length, 1);
assert.equal(q.pending()[0].mediaInfo.season, 2);
assert.equal(JSON.stringify(store).includes("never-save"), false);
const other = journal.create(file, {now: () => time, random: () => 0.7});
assert.equal(other.pending()[0].id, saved.id, "persisted across plugin reload");
assert.equal(other.acknowledge(saved.id), true);
assert.equal(q.pending().length, 0);
const early = q.record({progress: 40, mediaInfo: saved.mediaInfo});
time += 1000;
const newer = q.record({progress: 64, mediaInfo: saved.mediaInfo});
assert.ok(early && newer);
assert.equal(q.pending().length, 1, "coalesce older stops of the same item");
assert.equal(q.pending()[0].progress, 64);
assert.equal(q.pending()[0].id, newer.id);
q.acknowledge(newer.id);
assert.equal(q.record({progress: 0.8, mediaInfo: saved.mediaInfo}), null);
q.record({progress: 99.2, mediaInfo: saved.mediaInfo});
time += 49 * 60 * 60 * 1000;
assert.equal(q.pending().length, 0, "48h retention guard");
console.log("stop journal tests passed");