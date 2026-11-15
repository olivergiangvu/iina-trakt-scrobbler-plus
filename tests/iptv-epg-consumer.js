"use strict";
// Wiring regression: AIO programme metadata is display-only, never a Trakt ID.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const main=read("main.js"),sidebar=read("sidebar.html");
const identify=main.slice(main.indexOf("function identifyCurrentMedia()"),
  main.indexOf("function clearTimer(") );
const guard=identify.indexOf("if (picked.iptvMode)");
const episodeReader=identify.indexOf("var aiosContext=aioIdentitySidecar.find(");
const traktInspect=identify.indexOf("var external=freshIdentity.inspect(");
assert(guard>=0&&guard<episodeReader&&guard<traktInspect,
  "Xtream mode must exit before VOD ID inference and Trakt resolution");
assert(identify.slice(guard,episodeReader).includes("currentMedia = null"));
assert(identify.slice(guard,episodeReader).includes("aioIdentitySidecar.findProgramme"));
assert(identify.slice(guard,episodeReader).includes("Trakt auto-scrobbling is disabled"));
assert(main.includes("iptvPlayback.verified")&&main.includes("allowCorrection: false"));
assert(sidebar.includes("!state.playback.iptv"),
  "Correct Match must be hidden on IPTV programmes");
assert(sidebar.includes("EPG: ")&&sidebar.includes("Trakt disabled"));
assert(main.includes("aioIdentitySidecar.findProgramme(proofDeps,nowSource)"),
  "Retry delayed, read-only producer sidecar after IINA launch");
console.log("IPTV/EPG isolated from movie/episode scrobble, sidebar + delayed retry PASS");
