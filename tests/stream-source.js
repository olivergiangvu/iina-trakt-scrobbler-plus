const assert = require("assert");
const resolver = require("../stream-source.js");

const url = "https://host.example/stream/eyJ0b2tlbiI6MX0?media_id=tt11247158&media_type=series&torrent_name=The.Legend.of.Vox.Machina.S02E04.WEBDL.1080p.mkv";
const parsed = resolver.extract(url, "");
assert.deepStrictEqual(parsed, {
  name: "The.Legend.of.Vox.Machina.S02E04.WEBDL.1080p.mkv",
  imdb: "tt11247158",
  nameSource: "torrent_name"
});
assert.strictEqual(resolver.extract("https://cdn.example/eyJabc", "?torrent_name=Show.S01E02.mp4").name, "Show.S01E02.mp4");
assert.strictEqual(resolver.extract("https://cdn.example/stream.mkv?filename=Film%2520Name.2024.mkv", "").name, "Film Name.2024.mkv");
assert.strictEqual(resolver.extract("/Users/example/Films/Movie.mkv", "").name, "");
assert.strictEqual(resolver.extract("https://host/?media_id=abc123", "").imdb, "");
console.log("stream source tests passed");
