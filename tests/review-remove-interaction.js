const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const html=fs.readFileSync(path.resolve(__dirname,"../sidebar.html"),"utf8");
const main=fs.readFileSync(path.resolve(__dirname,"../main.js"),"utf8");
const start=html.indexOf("function bindReviewAction(button, action) {");
const end=html.indexOf("\n        review.forEach(function(item)",start);
assert.ok(start>=0&&end>start,"dynamic action helper exists");
const src=html.slice(start,end);
const scope={};
vm.runInNewContext(src+";\nthis.bindReviewAction=bindReviewAction;",scope);
function mockButton() {
  const callbacks={};
  return {disabled:false,events:callbacks,addEventListener(k,fn){callbacks[k]=fn;}};
}
function dispatch(button,type,key){
  let prevented=0,stopped=0;
  const e={type,button:0,key,preventDefault(){prevented++},
    stopPropagation(){stopped++}};
  assert.ok(typeof button.events[type]==="function","missing "+type);
  button.events[type](e);
  assert.ok(prevented>0,"button activation must prevent native selection "+type);
}
const b=mockButton();let actions=0;
scope.bindReviewAction(b,()=>{actions++});
dispatch(b,"pointerdown");
dispatch(b,"click");
assert.equal(actions,1,"pointerdown + click must not remove twice");
const c=mockButton();scope.bindReviewAction(c,()=>{actions++});
dispatch(c,"click");assert.equal(actions,2,"click-only fallback works");
const d=mockButton();scope.bindReviewAction(d,()=>{actions++});
dispatch(d,"keydown","Enter");assert.equal(actions,3,"keyboard works");
const disabled=mockButton();disabled.disabled=true;
scope.bindReviewAction(disabled,()=>{actions++});
dispatch(disabled,"pointerdown");
assert.equal(actions,3,"disabled remove is ignored");

assert.match(html,/confirmDiscardId = item\.id;/);
assert.match(html,/send\("discard_unverified_stop", \{id:item\.id\}\)/);
assert.match(html,/Cancel/);
assert.match(html,/Confirm remove/);
assert.match(html,/iina\.onMessage\("discard_unverified_result"/);
assert.match(html,/sync-review-item/);
assert.match(html,/role="status" aria-live="polite"/);
assert.match(main,/sidebar\.onMessage\("discard_unverified_stop"/);
assert.match(main,/sidebar\.postMessage\("discard_unverified_result",response\)/);
assert.match(main,/stopJournal\.review\(\)\.some/);
assert.match(main,/stopJournal\.discardReview\(id\)/);
assert.ok(!/sidebar\.onMessage\("discard_unverified_stop"[\s\S]*?\n  \}\);/.exec(main)[0].includes("stopReplayActive || activeStopSyncId"),"review cleanup should remain possible while playing");

console.log("IINA WKWebView Remove pointerdown/click/keyboard and ack-feedback contract PASS");