"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const sidecar=require("../aio-identity-sidecar.js");
const now=1794550000000;
const url="https://akm-cdn-play.hitv.ltd/token/index.m3u8?hdnts=abc&sign=opaque%2Bxyz";
const dir="/Users/tester/Library/Application Support/AIO-IINA-Bridge/identity";
const cfg="/Users/tester/Library/Application Support/AIO-IINA-Bridge/identity-settings.json";
const record=Object.freeze({
 schema:1,kind:"episode",provenance:"authenticated-aiostreams-item",
 origin:"https://aio.example.com",
 media_sha256:crypto.createHash("sha256").update(url,"utf8").digest("hex"),
 item_id:"87654321",media_source_id:"12345678",series_id:"abcd1234",
 season:1,episode:4,year:2026,canonical_title:"Fired Up!",
 ids:{imdb:"tt29932775",tmdb:239156,tvdb:0},
 issued_at_ms:now-5000,expires_at_ms:now+295000
});
function fixture(patch,config){
 const data={
  [cfg]:JSON.stringify(config||{enabled:true,origin:"https://aio.example.com"}),
  [dir+"/identity-0123456789abcdef0123456789abcdef.json"]:JSON.stringify({...record,...patch})
 };
 const calls=[];
 return {calls,data,deps:{
  resolvePath:p=>p.replace(/^~/,"/Users/tester"),
  file:{
   list:p=>{calls.push(["list",p]);return Object.keys(data)
    .filter(k=>k.startsWith(dir+"/"))
    .map(k=>({filename:k.slice(dir.length+1),path:k,isDir:false}));},
   read:p=>{calls.push(["read",p]);if(!Object.hasOwn(data,p))throw Error("ENOENT");return data[p];}
  }
 }};
}
for(const value of ["", "abc", url, "中文 🚀"]){
 assert.equal(sidecar.sha256(value),crypto.createHash("sha256").update(value).digest("hex"));
}
const f=fixture({});
assert.equal(sidecar.find(f.deps,{url},now).tmdb,239156);
assert.equal(sidecar.find(f.deps,{url},now).year,2026);
assert.equal(sidecar.find(f.deps,{url:"mpv://opaque",path:url},now).episode,4,
  "IINA may expose the exact playback URL via mpv path instead of core.url");
assert.equal(sidecar.find(f.deps,{url:url+"&unused=1"},now),null,"Signed URL changes require new descriptor");
assert.equal(sidecar.find(f.deps,{url:"https://other.cdn.example/index.m3u8"},now),null,
 "Do not reuse identity after CDN host changes");
assert.equal(sidecar.find(f.deps,{url},now+300001),null,"Five-minute expiry");
assert.equal(sidecar.find(fixture({season:0,episode:0}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({year:2025}).deps,{url},now).year,2025,
 "Reader only validates syntax; consumers must cross-verify producer year using provider");
assert.equal(sidecar.find(fixture({media_sha256:"0".repeat(64)}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({ids:{imdb:"bad",tmdb:239156}}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({expires_at_ms:now+600000}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({}, {enabled:false,origin:record.origin}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({}, {enabled:true,origin:"https://other.example"}).deps,{url},now),null);
assert.equal(sidecar.find(fixture({provenance:"filename-guess"}).deps,{url},now),null);
const conflict=fixture({});
conflict.data[dir+"/identity-fedcba9876543210fedcba9876543210.json"]=JSON.stringify({...record,ids:{imdb:"tt12345678",tmdb:1000}});
assert.equal(sidecar.find(conflict.deps,{url},now),null,"Conflicting contexts cannot claim one media URL");
assert(!f.calls.some(([_,p])=>p.includes("hdnts")||p.includes("sign=")),
 "Reader must never pass full URL to filesystem I/O");
console.log("AIO read-only sidecar: URL digest/TTL/HTTPS origin/IDs/conflicts/Unicode SHA-256 PASS");

// Live TV Catch-up is a Jellyfin `Program`, never a confirmed Trakt episode.
// The exact same URL digest, origin, TTL and source proof apply to display EPG.
const programme={
  ...record,kind:"iptv-catchup",provenance:"authenticated-aiostreams-program",
  channel_id:"channel12345678",channel_name:"US: Cooking Channel",
  program_title:"Man Fire Food",start_at_utc:"2026-11-15T15:00:00Z",
  end_at_utc:"2026-11-15T15:30:00Z",season:null,episode:null,
  trakt_eligible:false
};
const tv=fixture(programme);
const info=sidecar.findProgramme(tv.deps,{url},now);
assert.equal(info.programTitle,"Man Fire Food");
assert.equal(info.channelName,"US: Cooking Channel");
assert.equal(info.traktEligible,false);
assert.equal(sidecar.find(tv.deps,{url},now),null,
  "EPG must never enter the episode Trakt consumer");
assert.equal(sidecar.findProgramme(tv.deps,{url:url+"&wrong=1"},now),null);
assert.equal(sidecar.findProgramme(fixture({...programme,trakt_eligible:true}).deps,{url},now),null);
assert.equal(sidecar.findProgramme(fixture({...programme,origin:"https://evil.example"}).deps,{url},now),null);
assert.equal(sidecar.findProgramme(fixture({...programme,expires_at_ms:now+600000}).deps,{url},now),null);
assert.equal(sidecar.findProgramme(fixture({...programme,channel_name:"Bad\nChannel"}).deps,{url},now),null);
assert.equal(sidecar.findProgramme(fixture({...programme,end_at_utc:"2026-11-15T14:00:00Z"}).deps,{url},now),null);
const tvConflict=fixture(programme);
tvConflict.data[dir+"/identity-fedcba9876543210fedcba9876543210.json"]=
  JSON.stringify({...programme,program_title:"Not Man Fire Food"});
assert.equal(sidecar.findProgramme(tvConflict.deps,{url},now),null);
console.log("AIO Catch-up EPG sidecar: authenticated Program, no Trakt, TTL/hash/conflict PASS");
