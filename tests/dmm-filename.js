const assert=require("node:assert/strict");
const parser=require("../parser.js");
const identity=require("../playback-identity.js");
const streamSource=require("../stream-source.js");
const diag=require("../playback-diagnostics.js");
parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});

const torrent="a".repeat(40);
const release="Better.Call.Saul.S03E03.Sunk.Costs.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-NOGRP.mkv";
const rawFilename="98800072:1?h="+torrent+"&file="+release;
const url="https://debridmediamanager.com/api/resolve/stream/abc";
const src={
  url:url,path:url,
  title:rawFilename,
  filename:rawFilename,
  mediaTitle:rawFilename,
  metadataTitle:""
};
const extracted=streamSource.extract(src.filename,"");
assert.equal(extracted.name,release);
assert.equal(extracted.nameSource,"file");
const picked=identity.identify(src,parser,streamSource);
assert.equal(picked.parsed.kind,"episode");
assert.equal(picked.parsed.showTitle,"Better Call Saul");
assert.equal(picked.parsed.season,3);
assert.equal(picked.parsed.episode,3);
assert.equal(picked.source,"stream-file");
assert.equal(picked.parsed.parserSource,"stream-file");
assert.ok(!picked.parsed.showTitle.includes("98800072"));
assert.ok(!picked.parsed.showTitle.includes(torrent));
assert.equal(identity.isOpaque(rawFilename),true);
const share=diag.build(src,picked.parsed,
  "Better Call Saul S03E03 - Sunk Costs","0.2.5-beta.3");
const report=JSON.parse(share);
assert.equal(report.recognized.title,"Better Call Saul");
assert.equal(report.recognized.source,"stream-file");
assert.equal(report.player.filename,"[stream query redacted] "+release);
assert.equal(report.urlShapes[0].host,"debridmediamanager.com");
assert.ok(!share.includes(torrent),"torrent hash must never leak");
assert.ok(!share.includes("98800072:1?h="),"raw debrid path must never leak");
assert.ok(!share.includes("?h="),"query string must never leak");
assert.equal(report.freshExternalId,null);
assert.equal(report.mediaFusionRoute,null);
const queryOnly={url:url,path:url,title:"98800072:1?h="+torrent,
  filename:"98800072:1?h="+torrent,mediaTitle:"98800072:1?h="+torrent};
const noMatch=identity.identify(queryOnly,parser,streamSource);
assert.equal(noMatch.parsed,null,"opaque DMM labels without a filename must not become media");
const clean=identity.identify({url,path:url,title:rawFilename,filename:rawFilename,
 mediaTitle:rawFilename,metadataTitle:"Better Call Saul S03E03"},parser,streamSource);
assert.equal(clean.source,"mpv-metadata-title","real metadata may still win");
assert.equal(clean.parsed.showTitle,"Better Call Saul");
console.log("DMM filename parsing, correct TV identity, privacy redaction regression PASS");