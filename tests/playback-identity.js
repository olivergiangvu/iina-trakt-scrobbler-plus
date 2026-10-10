const assert = require("node:assert/strict");
const plugin = require("../playback-identity.js");
const parser = require("../parser.js");
const stream = require("../stream-source.js");

parser.configure({
  loadGuessitModule: () => require("../vendor/guessit-js.compat.js")
});
const bad = "D-T2iLra-KCKH4UyqlfXVtqM S02E90 - Vqjpyd-ouHXhzylwYz9uIOddOe5ffoyKW6M";
const url = "https://stream.example/" + bad +
  "?media_id=tt11247158&media_type=series";
const picked = plugin.identify({
  url: url,
  path: url,
  title: bad,
  filename: "La leggenda di Vox Machina - S02E06 - Arrivo a Rimecleft.mkv",
  mediaTitle: "La leggenda di Vox Machina - S02E06 - Arrivo a Rimecleft.mkv"
}, parser, stream);
assert.equal(picked.parsed.kind, "episode");
assert.equal(picked.parsed.season, 2);
assert.equal(picked.parsed.episode, 6);
assert.equal(picked.imdb, "tt11247158");
assert.notEqual(picked.parsed.episode, 90);
assert.equal(picked.source, "mpv-filename");

const fallback = plugin.identify({
  url: "https://stream.example/eyJodHRwcyI6MX0?torrent_name=The.Legend.of.Vox.Machina.S02E04.WEBDL.mkv&media_id=tt11247158",
  title: "eyJodHRwcyI6MX0"
}, parser, stream);
assert.equal(fallback.parsed.kind, "episode");
assert.equal(fallback.parsed.season, 2);
assert.equal(fallback.parsed.episode, 4);
assert.equal(fallback.source, "stream-torrent_name");

const invalid = plugin.identify({url: "https://stream.example/" + bad,title:bad}, parser, stream);
assert.equal(invalid.parsed, null, "opaque path must not be auto-scrobbled");
console.log("playback identity tests passed");