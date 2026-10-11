const assert=require("node:assert/strict");
const fresh=require("../fresh-identity.js");
const identity=require("../playback-identity.js");
const parser=require("../parser.js");
const stream=require("../stream-source.js");
parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});

const filename="Better.Call.Saul.S03E03.2160p.Netflix.WEBRip.2xRus.Eng.ViSUM-ULTRAHDCLUB.mkv";
const video="https://comet.feels.legal/token/playback/id/0/1/3/3"+
  "?torrent_name="+encodeURIComponent(filename)+"&media_id=tt3032476&media_type=series";
const source={
  path:video,url:video,title:"Better Call Saul - Season 3, Episode 3: Sunk Costs (2017) - Release for HDCLUB",
  filename:"opaque-id?h=redacted&file="+encodeURIComponent(filename),
  metadataTitle:"Better Call Saul - Season 3, Episode 3: Sunk Costs (2017) - Release for HDCLUB"
};
const picked=identity.identify(source,parser,stream);
assert.equal(picked.parsed.kind,"episode");
assert.equal(picked.parsed.season,3);
assert.equal(picked.parsed.episode,3);
assert.equal(picked.parsed.showTitle,"Better Call Saul");
const inspected=fresh.inspect(source,null);
assert.equal(inspected.conflict,false);
assert.equal(inspected.imdb,"tt3032476");
assert.equal(inspected.kind,"episode");
assert.equal(inspected.season,null);
assert.equal(inspected.episode,null);
const accepted=fresh.coordinateEpisode(inspected,picked.parsed);
assert.equal(accepted.conflict,false);
assert.equal(accepted.external.season,3);
assert.equal(accepted.external.episode,3);
assert.equal(accepted.external.expectedShowTitle,"Better Call Saul");
assert.ok(fresh.titlesAgree("Better Call Saul","Better Call Saul"));
assert.equal(fresh.titlesAgree("Better Call Saul","Breaking Bad"),false,
  "An IMDb ID for the wrong show must not be accepted by a valid S/E alone");

const parsed={kind:"episode",showTitle:"Better Call Saul",season:3,episode:3};
assert.equal(fresh.coordinateEpisode(inspected,{kind:"movie",title:"Better Call Saul"}).conflict,true);
assert.equal(fresh.coordinateEpisode(inspected,{...parsed,unresolvedShow:true}).conflict,true);
assert.equal(fresh.coordinateEpisode(inspected,{...parsed,showTitle:"Unknown Series"}).conflict,true);
assert.equal(fresh.coordinateEpisode(inspected,{...parsed,season:101}).conflict,true);
assert.equal(fresh.coordinateEpisode(inspected,{...parsed,episode:0}).conflict,true);
assert.equal(fresh.coordinateEpisode(inspected,null).conflict,true);
const mismatch=fresh.coordinateEpisode({...inspected,season:2},parsed);
assert.equal(mismatch.conflict,true,"Explicit S/E must never be overwritten by a filename");
const partial=fresh.coordinateEpisode({...inspected,season:3},parsed);
assert.equal(partial.conflict,false);
assert.equal(partial.external.episode,3);
assert.equal(partial.external.expectedShowTitle,"Better Call Saul");

const complete=fresh.coordinateEpisode({...inspected,season:3,episode:3},null);
assert.equal(complete.conflict,false);
assert.equal(complete.external.episode,3);
assert.equal(complete.expectedShowTitle,"",
  "Explicit S/E does not require a second inferred title");

assert.equal(fresh.coordinateEpisode(null,parsed).conflict,false);
assert.equal(fresh.coordinateEpisode({conflict:true,kind:"episode"},parsed).conflict,true);
assert.equal(fresh.titlesAgree("Bêtter Càll Saul","better call saul"),true);
console.log("Comet show IMDb + filename S/E coordination and safety tests PASS");
