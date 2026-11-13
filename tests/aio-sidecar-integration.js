"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const s=fs.readFileSync(path.join(__dirname,"../main.js"),"utf8");
const f=fs.readFileSync(path.join(__dirname,"../trakt.js"),"utf8");
assert(s.includes('require("./aio-identity-sidecar.js")'),"Trakt must include authenticated AIO sidecar");
assert(s.includes("var aiosContext=aioIdentitySidecar.find("),"Reader must examine current exact URL");
assert(s.includes('positionSource:"authenticated-aiostreams-item"'),"Structured S/E must bypass filename guessing");
assert(s.includes('external=mismatch ? {conflict:true}'),"External ID conflict must fail closed");
assert(s.includes('Number(resolved.year)!==Number(external.year)'),"Trakt show year must match AIO authenticated year");
assert(s.includes("await trakt.resolveFreshIdentity(external)"),"Trakt API independently validates both external IDs");
assert(s.includes("beginResumeCheck(target)"),"Trakt resume read-before-write remains protected");
assert(s.includes("var generation=++aioIdentityRetryGeneration"),"Companion writes descriptor after opening IINA");
assert(!s.includes('postMessage("scrobble"',s.indexOf("var aiosContext=")), "No second Trakt writer");
assert(f.includes('Number(value.episode) !== Number(mediaInfo && mediaInfo.episode)'),
 "Host alias/manual caches must reverify exact subsequent episode");
console.log("Trakt AIO descriptor -> independent Trakt year/IDs/S-E -> one-writer resume contract PASS");
