const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html=fs.readFileSync(require("node:path").resolve(__dirname,"../sidebar.html"),"utf8");
const last=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(last,"sidebar inline script exists");
new vm.Script(last[1],{filename:"sidebar.html"});
for (const id of ["sync-queue-section","sync-queue-summary","sync-queue-retry",
  "sync-queue-pending","sync-queue-synced","sync-queue-last-sync",
  "network-status","network-detail"]) {
  assert.ok(html.includes('id="'+id+'"'),"missing markup "+id);
}
assert.match(html,/function renderSyncQueue\(\)/);
assert.match(html,/bindLocalAction\("sync-queue-retry"/);
assert.match(html,/send\("retry_pending_stops"\)/);
assert.match(html,/retry\.disabled\s*=\s*!stateReady\s*\|\|\s*!q\.canRetry/);
assert.ok(!/\.innerHTML\s*=\s*item\./.test(html),
  "do not inject metadata as HTML");
console.log("Sync Queue sidebar script and contract tests passed");