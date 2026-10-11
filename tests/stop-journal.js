const assert=require("node:assert/strict");
const {create}=require("../stop-journal.js");
let now=10000000,rnd=0.25,fs={};
const io={exists:p=>Object.hasOwn(fs,p),read:p=>fs[p],write:(p,v)=>fs[p]=v};
const q=create(io,{now:()=>now,random:()=>rnd});
const show={type:"episode",title:"The Legend of Vox Machina",
 showTitle:"The Legend of Vox Machina",season:2,episode:8,
 episodeTitle:"Strom ozvěny",manualTraktId:4242,
 streamUrl:"https://torbox.example/private?token=SECRET"};
// Legacy beta.4 checkpoints (already on user's Mac) must not silently replay.
const legacyMovie={id:"old-movie",createdAt:now-180000,progress:38,
 mediaInfo:{type:"movie",title:"Strom OzvěNy"}};
const legacyUnresolved={id:"old-series",createdAt:now-120000,progress:41,
 mediaInfo:{type:"episode",title:"Unknown Series",showTitle:"Unknown Series",
 season:2,episode:8,episodeTitle:"Strom ozvěny"}};
fs["@data/pending-final-scrobbles.json"]=JSON.stringify([legacyMovie,legacyUnresolved]);
assert.equal(q.pending().length,0);
assert.equal(q.review().length,2);
assert.equal(q.find("old-movie").mediaInfo.title,"Strom OzvěNy");
assert.equal(q.discardReview("old-movie"),true);
assert.equal(q.review().length,1);
assert.equal(q.record({progress:50,mediaInfo:show}),null,"no proof -> no durable write");
assert.equal(q.record({progress:51,mediaInfo:legacyUnresolved.mediaInfo},
 {kind:"manual",traktId:4242}),null,"unknown series cannot become safe using ID alone");
const ok=q.record({progress:52,mediaInfo:show},{kind:"manual",traktId:4242});
assert.ok(ok);assert.equal(q.pending().length,1);
assert.equal(q.review().length,1);
assert.equal(q.pending()[0].replayProof.traktId,4242);
assert.ok(!JSON.stringify(fs).includes("SECRET"),"never save signed stream URLs");
rnd=0.34;now+=1000;
const newer=q.record({progress:64,mediaInfo:show},{kind:"trakt-confirmed",traktId:4242});
assert.ok(newer);
assert.equal(q.pending().length,1,"latest trusted stop supersedes prior proof");
assert.equal(q.pending()[0].progress,64);
assert.equal(q.acknowledge(newer.id),true);
assert.equal(q.pending().length,0);
assert.equal(q.discardReview("old-series"),true);
assert.equal(q.review().length,0);
const fromImdb=q.record({progress:30,mediaInfo:{type:"movie",title:"A Film",imdb:"tt1234567"}},
 {kind:"imdb",imdb:"tt1234567"});
assert.ok(fromImdb);
assert.equal(q.discardReview(fromImdb.id),false,"cannot discard verified stop via review-only API");
assert.equal(q.markReview(fromImdb.id,"Trakt rejected ID"),true);
assert.equal(q.pending().length,0);assert.equal(q.review()[0].reviewReason,"Trakt rejected ID");
assert.equal(q.discardReview(fromImdb.id),true);
assert.equal(q.review().length,0);
const fresh=create(io,{now:()=>now,random:()=>0.7});
const persistent=fresh.record({progress:77,mediaInfo:show},{kind:"manual",traktId:4242});
assert.equal(q.pending()[0].id,persistent.id);
now+=49*60*60*1000;
assert.equal(q.pending().length,0,"48-hour retention rule");
console.log("verified stop journal, legacy quarantine and safe removal tests passed");