const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../sidebar.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(script, "sidebar inline script exists");
new vm.Script(script[1], {filename: "sidebar.html"});
assert.match(html, /id="correction-season"[^>]*type="text"[^>]*inputmode="numeric"/);
assert.match(html, /id="correction-episode"[^>]*type="text"[^>]*inputmode="numeric"/);
assert.match(html, /bindCorrectionPositionInput\("correction-season", "season"\)/);
assert.match(html, /bindCorrectionPositionInput\("correction-episode", "episode"\)/);
assert.match(html, /var position = readCorrectionPosition\(\);\s*requestAction\("choose_correction"/);
assert.doesNotMatch(html, /document\.activeElement !== seasonInput/,
  "do not depend on unreliable WKWebView focus while rerendering");

// Exercise the actual production draft helpers, including input/change events.
const start = script[1].indexOf("var correctionDraft = null;");
const end = script[1].indexOf("\n      function send(name, payload)", start);
assert.ok(start >= 0 && end > start, "draft helpers must be present");
const events = {};
const elements = {};
for (const id of ["correction-season", "correction-episode"]) {
  elements[id] = {
    value: "",
    addEventListener(name, fn) {
      events[id + ":" + name] = fn;
    }
  };
}
const context = {
  state: { correction: {
    active: true, kind: "episode", mediaKey: "hls-index.m3u8",
    mediaLabel: "Index m3u8", season: "1", episode: "6"
  }},
  document: {getElementById(id) {return elements[id];}}
};
vm.createContext(context);
vm.runInContext(script[1].slice(start, end), context);
vm.runInContext('bindCorrectionPositionInput("correction-season", "season")', context);
vm.runInContext('bindCorrectionPositionInput("correction-episode", "episode")', context);
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("readCorrectionPosition()", context))),
  {season: "1", episode: "6"});
elements["correction-episode"].value = "10";
events["correction-episode:input"]();
elements["correction-season"].value = "1";
events["correction-season:change"]();
// Replicate a 2-second backend state refresh that still contains stale E06.
context.state.correction = {...context.state.correction, episode: "6"};
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("readCorrectionPosition()", context))),
  {season: "1", episode: "10"}, "backend redraw must not overwrite typed E10");
// New playback gets new draft rather than carrying the old episode.
context.state.correction = {...context.state.correction,mediaKey: "new-episode",episode: "3"};
assert.equal(vm.runInContext("readCorrectionPosition().episode",context),"3");
context.state.correction.active = false;
assert.equal(vm.runInContext("readCorrectionPosition().episode",context),"");
context.state.correction = {...context.state.correction, active: true, episode: "5"};
assert.equal(vm.runInContext("readCorrectionPosition().episode",context),"5");
console.log("Manual S/E editing survives stale sidebar snapshots and resets on new media PASS");
