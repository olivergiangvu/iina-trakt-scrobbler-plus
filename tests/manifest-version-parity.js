"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../Info.json");
const source = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
const match = source.match(/\bvar\s+PLUGIN_VERSION\s*=\s*["']([^"']+)["']/);
assert(match, "Playback diagnostics must expose an explicit plugin version");
assert.equal(match[1], manifest.version,
  "Playback diagnostics must report the installed manifest version, including beta suffix");
console.log("Installed plugin manifest and playback diagnostics version parity PASS");
