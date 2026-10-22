const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {sha256, createCompanionCallback} = require("../aio-companion-callback.js");

for (const test of [
  "", "abc", "https://cdn.example/signed?token=abc&name=é", "http://foo/video.m3u8?x=%20",
  "https://cdn.example/\u2603/episode.mp4"
]) {
  assert.equal(sha256(test), crypto.createHash("sha256").update(test).digest("hex"));
}

const STREAM = "https://cdn.example/master.m3u8?token=private";
const session = "a".repeat(32);
const now = 1_700_000_000_000;
const dir = "/fake/sessions";
const records = {
  [dir + "/" + session + ".json"]: JSON.stringify({
    schema: 1,
    session: session,
    url_sha256: sha256(STREAM),
    return_url: "https://aio.example/jellyfin/web#/show?played=12345678&source=abcdef12",
    issued_at_ms: now - 3000,
    expires_at_ms: now + 60000
  })
};
const calls = [];
const file = {
  list: () => [{ filename: session + ".json", isDir: false }],
  read: path => records[path]
};
const utils = {
  resolvePath: p => p === "~/Library/Application Support/AIO-IINA-Bridge/sessions" ? dir : p,
  fileInPath: p => p === "/fake/callback_session.py",
  exec: async (bin, args) => {
    calls.push({bin,args});
    return {status:0};
  }
};
let enabled = false;
const callback = createCompanionCallback({
  file, utils, now: () => now,
  enabled: () => enabled, helperPaths: ["/fake/callback_session.py"]
});
assert.equal(callback.onLoaded([STREAM]), false, "opt-in stays off");
enabled = true;
assert.equal(callback.onLoaded(["https://cdn.example/other"]), false, "unrelated playback never matches");
assert.equal(callback.onLoaded([STREAM]), true, "exact media SHA must match");
callback.onPosition(31.8, 120);
callback.onPosition(32.9, 120);
(async () => {
  assert.equal(await callback.onClose(0, 0), true, "last-good position survives mpv reset");
  assert.deepEqual(calls, [{bin:"/usr/bin/python3",
    args:["/fake/callback_session.py","--complete",session,"--position","32"]}]);
  assert.equal(await callback.onClose(50,120), false, "no duplicate");
  assert.equal(calls.length,1);
  const another = createCompanionCallback({
    file,utils, now: () => now, enabled: () => true,
    helperPaths: ["/does-not-exist"]
  });
  another.onLoaded([STREAM]);
  another.onPosition(55, 120);
  assert.equal(await another.onClose(55,120), false, "missing app is safe");
  assert.equal(calls.length,1);
  console.log("PASS IINA companion: SHA256 / opt-in / exact session / Resume / at-most-once / no helper fallback");
})().catch(err=>{console.error(err);process.exitCode=1;});
