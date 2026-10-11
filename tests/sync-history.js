const assert = require("node:assert/strict");
const {create} = require("../sync-history.js");
let ms = 10000000; const data = {};
const file = {exists:p=>Object.prototype.hasOwnProperty.call(data,p),
 read:p=>data[p],write:(p,s)=>data[p]=s};
const a = create(file,{now:()=>ms});
assert.deepStrictEqual(a.recent(), []);
assert.equal(a.record({id:"stop-1",progress:48.5,mediaInfo:{
  type:"episode",title:"The Legend of Vox Machina",
  season:2,episode:7,sourceUrl:"https://example?token=SECRET",accessToken:"SECRET"
}}, "ok"),true);
assert.equal(a.recent()[0].label,"The Legend of Vox Machina S02E07");
assert.equal(a.recent()[0].status,"confirmed");
assert.equal(JSON.stringify(data).includes("SECRET"),false);
const b=create(file,{now:()=>ms});
assert.equal(b.recent().length,1,"survives process reload");
assert.equal(b.record({id:"stop-1",progress:48.5,mediaInfo:{type:"movie",title:"Film"}}, "duplicate"),true);
assert.equal(b.recent().length,1,"same id recorded once");
assert.equal(b.recent()[0].status,"confirmed_duplicate");
for (let n=0;n<20;n++){ms+=1000;b.record({id:"new-"+n,mediaInfo:{type:"movie",title:"Film "+n},progress:55},"ok");}
assert.equal(b.recent().length,12);
assert.equal(b.recent()[0].id,"new-19");
ms+=8*24*60*60*1000;
assert.equal(b.recent().length,0,"bounded retention");
console.log("sync history tests passed");