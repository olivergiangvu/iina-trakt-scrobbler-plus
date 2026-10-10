const assert=require("node:assert/strict");
const diag=require("../playback-diagnostics.js");
const url="https://mediafusion.elfhosted.com/streaming_provider/D-SecretToken-987/playback/torbox/f6738693f7d3/2/8?auth_token=SECRET&media_id=tt11247158";
const d=diag.build({url,path:url,title:"Strom ozvěny",filename:"Strom ozvěny",
  mediaTitle:"Strom ozvěny"},
  {kind:"movie",title:"Strom ozvěny"},"Gegen den Strom – Abgetaucht in Venezuela","0.2.4-beta.2");
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
console.log("redacted playback diagnostics tests passed");