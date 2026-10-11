const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const html=fs.readFileSync(path.resolve(__dirname,"../sidebar.html"),"utf8");
const main=fs.readFileSync(path.resolve(__dirname,"../main.js"),"utf8");
const js=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(js);
new vm.Script(js[1],{filename:"sidebar.html"});
for(const id of ["match-provenance","sync-queue-review",
 "sync-queue-review-header","sync-queue-pending","sync-queue-retry"]){
 assert.ok(html.includes('id="'+id+'"'),"missing "+id);
}
assert.match(html,/p\.label\s*\?\s*"Match source: "\s*\+\s*p\.label/);
assert.match(html,/matchProvenance:\s*determineMatchProvenance/);
assert.match(main,/mediafusion-confirmed-pack/);
assert.match(main,/Confirmed Pack Cache/);
assert.match(main,/Manual Confirmed/);
assert.match(main,/Direct IMDb ID/);
assert.match(main,/Trakt Verified/);
assert.match(main,/Needs Manual Match/);
assert.match(main,/stopJournal\.review\(\)/);
assert.match(main,/stopJournal\.record\(payload,\s*trustedReplayProof/);
assert.match(main,/stopJournal\.markReview\(journalId/);
assert.match(html,/confirmDiscardId\s*!==\s*item\.id/);
assert.match(html,/send\("discard_unverified_stop",\s*\{id:item\.id\}\)/);
assert.match(main,/sidebar\.onMessage\("discard_unverified_stop"/);
assert.match(main,/stopJournal\.discardReview\(id\)/);
assert.ok(!/reviewList\.innerHTML\s*=/.test(html),"safe DOM rendering only");
console.log("provenance, Needs Review and two-step queue removal contract passed");