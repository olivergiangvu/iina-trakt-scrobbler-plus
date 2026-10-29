"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.resolve(__dirname,"../sidebar.html"),"utf8");
const manifest=require("../Info.json");
assert.equal(manifest.version,"0.2.9-beta.4");
assert.equal(manifest.ghVersion,32);
for(const t of [
 "--plus-glass-panel:rgba(16,22,32,.14)",
 "--plus-glass-border:rgba(255,255,255,.16)",
 "--plus-glass-primary:#e9edf3",
 "--plus-glass-secondary:rgba(233,237,243,.76)",
 "--plus-glass-blur:14px",
 "--plus-glass-panel:rgba(248,250,253,.16)",
 "--plus-glass-border:rgba(34,49,70,.15)",
 "--plus-glass-primary:#19283a",
 "--plus-glass-secondary:#40546d"
])assert(source.includes(t),"Shared Plus palette missing: "+t);
assert(/html,\s*body\s*\{[^}]*background:\s*transparent/s.test(source));
assert(/body\s*\{[^}]*background:\s*none/s.test(source));
assert(source.includes("background: var(--plus-glass-panel)"));
assert(source.includes("border-color: var(--plus-glass-border)"));
for(const m of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
 new vm.Script(m[1],{filename:"Trakt+ sidebar"});
console.log("Trakt+ Light/Dark glass-parity contract PASS");
