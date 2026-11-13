const assert=require("node:assert/strict");
const diag=require("../playback-diagnostics.js");
const url="https://mediafusion.elfhosted.com/streaming_provider/D-SecretToken-987/playback/torbox/f6738693f7d3d0aed66035633895c6a10751e867/2/8?auth_token=SECRET&media_id=tt11247158";
const d=diag.build({url,path:url,title:"Strom ozvěny",filename:"Strom ozvěny",
  mediaTitle:"Strom ozvěny"},
  {kind:"movie",title:"Strom ozvěny"},"Gegen den Strom – Abgetaucht in Venezuela","0.2.4-beta.3");
const obj=JSON.parse(d);
assert.equal(obj.urlShapes[0].host,"mediafusion.elfhosted.com");
assert.ok(obj.urlShapes[0].pathShape.endsWith("/2/8"));
assert.deepEqual(obj.urlShapes[0].queryKeys,["auth_token","media_id"]);
assert.equal(obj.urlShapes[0].imdb,"tt11247158");
for(const secret of ["SecretToken","f6738693","SECRET","auth_token=SECRET"]){
 assert.ok(!d.includes(secret),"leaked "+secret);
}
assert.equal(obj.player.title,"Strom ozvěny");
assert.equal(obj.traktTarget,"Gegen den Strom – Abgetaucht in Venezuela");
assert.deepEqual(obj.mediaFusionRoute,{kind:"episode",season:2,episode:8,
  provider:"torbox",seriesIdentityAvailable:true});
const cdn=diag.build({title:"Fired Up! S01E04",mediaTitle:"Fired Up! S01E04",
 filename:"*_hmac=SECRET_HMAC&sign=SECRET_SIGN%2Bopaque&cp=SECRET_CP",
 url:"https://akm-cdn-play.hitv.ltd/opaque/index.m3u8?hdnts=SECRET_HDNT&sign=SECRET_SIGN"},
 {kind:"episode",showTitle:"Fired Up!",season:1,episode:4},"","0.2.9");
const parsed=JSON.parse(cdn);
assert.equal(parsed.player.filename,"[signed stream filename redacted]");
assert.deepEqual(parsed.urlShapes[0].queryKeys,["hdnts","sign"]);
for(const secret of ["SECRET_HMAC","SECRET_SIGN","SECRET_CP","SECRET_HDNT"])
 assert(!cdn.includes(secret),"HLS signed credential leaked: "+secret);
console.log("redacted playback diagnostics tests passed");