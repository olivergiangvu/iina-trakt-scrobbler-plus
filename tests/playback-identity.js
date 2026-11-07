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
const packHash="f6738693f7d3d0aed66035633895c6a10751e867";
const packUrl="https://mediafusion.elfhosted.com/streaming_provider/D-private/playback/torbox/"+packHash+"/2/8";
const episodeOnly=plugin.identify({
  url:packUrl,path:packUrl,title:"Strom ozvěny",filename:"8",
  metadataTitle:"Strom ozvěny",mediaTitle:"Strom ozvěny"
},parser,stream);
assert.equal(episodeOnly.parsed.kind,"episode");
assert.equal(episodeOnly.parsed.season,2);
assert.equal(episodeOnly.parsed.episode,8);
assert.equal(episodeOnly.parsed.episodeTitle,"Strom ozvěny");
assert.equal(episodeOnly.parsed.unresolvedShow,true);
assert.equal(episodeOnly.source,"mediafusion-episode-route");
assert.ok(episodeOnly.episodeRoute.fingerprint);
assert.equal(episodeOnly.imdb,"");
const proper=plugin.identify({
  url:packUrl,path:packUrl,title:"The Legend of Vox Machina S02E08",
  filename:"The.Legend.of.Vox.Machina.S02E08.mkv"
},parser,stream);
assert.equal(proper.parsed.kind,"episode");
assert.equal(proper.parsed.unresolvedShow,undefined);
const conflicted=plugin.identify({
  url:packUrl,path:packUrl,title:"Fake.Show.S03E01",
  filename:"Fake.Show.S03E01.mkv"
},parser,stream);
assert.equal(conflicted.parsed.kind,"episode");
assert.equal(conflicted.parsed.unresolvedShow,true);
assert.equal(conflicted.parsed.season,2);
assert.equal(conflicted.parsed.episode,8);

console.log("playback identity tests passed");
const hls = plugin.identify({
  url:"https://a.kvp726.com/tokenized/hls/index.m3u8",
  path:"https://a.kvp726.com/tokenized/hls/index.m3u8",
  filename:"index.m3u8",
  mediaTitle:"City of Splendour · S01E01 · Episode 1",
  title:"City of Splendour · S01E01 · Episode 1",
  metadataTitle:""
}, parser, stream);
assert.equal(hls.source, "mpv-media-title");
assert.equal(hls.parsed.kind, "episode");
assert.equal(hls.parsed.showTitle.toLowerCase(), "city of splendour");
assert.equal(hls.parsed.season, 1);
assert.equal(hls.parsed.episode, 1);
assert.equal(hls.parsed.episodeTitle.toLowerCase(), "episode 1");
// The generic HLS manifest itself must not become a movie identity.
const noHlsTitle = plugin.identify({
  url:"https://a.kvp726.com/tokenized/hls/index.m3u8",
  filename:"index.m3u8",
  mediaTitle:"index.m3u8", metadataTitle:""
}, parser, stream);
assert.equal(noHlsTitle.parsed, null);
