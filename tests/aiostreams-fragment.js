const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const fragment=require("../aiostreams-fragment.js");
const identity=require("../playback-identity.js");
const parser=require("../parser.js");
const stream=require("../stream-source.js");

parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});
const title="OK! Let's Get Divorced · S01E10 · A Second Chance At Love";
const url="https://a.kvp726.com/private/index.m3u8#aios_title="+encodeURIComponent(title);
const source={url,path:url,title:"index.m3u8#aios_title="+title,
  filename:"index.m3u8#aios_title="+title,mediaTitle:"index.m3u8#aios_title="+title};
const f=fragment.inspect(source);
assert.equal(f.present,true);
assert.equal(f.valid,true);
assert.equal(f.parsed.showTitle,"OK! Let's Get Divorced");
assert.equal(f.parsed.season,1);
assert.equal(f.parsed.episode,10);
assert.equal(f.parsed.episodeTitle,"A Second Chance At Love");
const picked=identity.identify(source,parser,stream);
assert.equal(picked.source,"aiostreams-title-fragment");
assert.equal(picked.parsed.parserSource,"aiostreams-title-fragment");
assert.equal(picked.parsed.showTitle,"OK! Let's Get Divorced");
assert.equal(picked.parsed.season,1);
assert.equal(picked.parsed.episode,10);
assert.ok(!picked.parsed.showTitle.includes("Index"));
const noFragment=identity.identify({
  path:"https://a.kvp726.com/path/index.m3u8",
  filename:"index.m3u8",title:"index.m3u8",mediaTitle:"index.m3u8"
},parser,stream);
assert.equal(noFragment.parsed,null,"bare HLS index must not become a film/show");
// A title-only fragment can be a movie, but without an independent year
// it MUST NOT be auto-scrobbled. The strict movie resolver enforces this.
const titleOnly=identity.identify({
  url:"https://example.com/index.m3u8#aios_title=Not%20An%20Episode",
  path:"https://example.com/index.m3u8#aios_title=Not%20An%20Episode",
  filename:"index.m3u8"
},parser,stream);
assert.equal(titleOnly.parsed.kind,"movie");
assert.equal(titleOnly.parsed.year,null);
for(const malformed of [
  "#aios_title="+encodeURIComponent("Other Show · S01E00"),
  "#aios_title="+encodeURIComponent("Index.m3u8 · S01E10"),
  "#aios_title=%XY",
  "#aios_title="+encodeURIComponent(title)+"&aios_title=Other"
]){
  const bad=identity.identify({url:"https://example.com/index.m3u8"+malformed,
    path:"https://example.com/index.m3u8"+malformed,
    filename:"index.m3u8"},parser,stream);
  assert.equal(bad.parsed,null,"invalid fragment must fail closed: "+malformed.slice(0,25));
}
const main=fs.readFileSync(path.join(__dirname,"../main.js"),"utf8");
assert.match(main,/identitySource: parsed\.parserSource === "aiostreams-title-fragment"/);
assert.match(main,/identitySource: mediaInfo\.identitySource === "aiostreams-title-fragment"/);
console.log("AIOStreams HLS fragment parsing, precedence and fail-closed tests PASS");
