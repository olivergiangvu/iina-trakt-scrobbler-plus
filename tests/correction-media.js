const assert=require("node:assert/strict");
const c=require("../correction-media.js");
const mistaken={type:"movie",title:"Strom OzvěNy"};
const route={season:2,episode:8};
assert.equal(c.preferredKind(mistaken,route),"episode");
assert.equal(c.preferredKind(mistaken,null),"movie");
assert.deepEqual(c.episodePosition(mistaken,route),{season:"2",episode:"8"});
const search=c.searchMedia(mistaken,"episode",route);
assert.equal(search.type,"episode");assert.equal(search.episode,8);
const selected=c.selectMedia(mistaken,"episode",
 {kind:"episode",trakt:411,title:"The Legend of Vox Machina"},2,8);
assert.equal(selected.type,"episode");assert.equal(selected.episodeTitle,"Strom OzvěNy");
assert.equal(selected.showTitle,"The Legend of Vox Machina");
assert.equal(selected.manualTraktId,411);
assert.throws(()=>c.selectMedia(mistaken,"episode",{kind:"movie",title:"Shang-Chi"},2,8));
assert.throws(()=>c.selectMedia(mistaken,"episode",{kind:"episode",title:"Show"},2,0));
assert.equal(c.selectMedia({type:"episode",showTitle:"Bad Guess"},"movie",
 {kind:"movie",title:"Proper Movie",year:2021},null,null).title,"Proper Movie");
console.log("manual Movie / TV Series cross-type correction tests passed");