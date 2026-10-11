const assert=require("node:assert/strict");
const fresh=require("../fresh-identity.js");
const route={season:2,episode:8};
const h="f6738693f7d3d0aed66035633895c6a10751e867";
const url="https://mediafusion.elfhosted.com/streaming_provider/D-SECRET/playback/torbox/"+h+"/2/8";
assert.equal(fresh.inspect({path:url,url:url},route),null,"no show ID in opaque MediaFusion url");
let x=fresh.inspect({path:url+"?media_id=tt11247158&media_type=series"},route);
assert.deepEqual(x,{conflict:false,imdb:"tt11247158",tmdb:0,kind:"episode",season:2,episode:8,source:"explicit-playback-id"});
x=fresh.inspect({path:url+"?tmdb_id=135934&media_type=series"},route);
assert.equal(x.tmdb,135934);assert.equal(x.kind,"episode");assert.equal(x.episode,8);
assert.equal(fresh.inspect({path:url+"?media_id=tmdb%3A135934&media_type=series"},route).tmdb,135934);
assert.equal(fresh.inspect({path:url+"?media_id=tt11247158&media_type=movie"},route).conflict,true);
assert.equal(fresh.inspect({path:url+"?media_id=tt11247158&imdb_id=tt76543210"},route).conflict,true);
assert.equal(fresh.inspect({path:url+"?media_id=tt11247158",url:url+"?imdb=tt98765432"},route).conflict,true);
assert.equal(fresh.inspect({path:url+"?tmdb_id=00123"},route),null,"invalid tmdb id ignored");
const st="http://127.0.0.1:11470/stream/series/tt11247158:2:8.json";
x=fresh.inspect({path:st},null);assert.equal(x.imdb,"tt11247158");assert.equal(x.episode,8);
assert.equal(fresh.inspect({path:st,url:st},route).conflict,false);
assert.equal(fresh.inspect({path:"https://x.test/playback/tt11247158/2/8"},route),null,
 "not trust arbitrary path IDs");
assert.equal(fresh.inspect({path:"https://x.test/a?token=tt11247158"},route),null,
 "not trust a token that resembles imdb id");
assert.ok(!JSON.stringify(x).includes("127.0.0.1"));
console.log("fresh trusted ID extraction tests PASS");