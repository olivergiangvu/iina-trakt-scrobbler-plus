"use strict";
const assert=require("node:assert/strict");
const registry=require("../trusted-series-aliases.js");
function row(alias,year,imdb,tmdb,host){
 return {kind:"episode",alias,canonicalTitle:"The True Title",year,imdb,tmdb,
  trakt:0,originHost:host,evidence:"user chose correct show",source:"user-confirmed"};
}
const target=row("The Other Name",2025,"tt12345678",22222,"cdn.example");
assert.equal(registry.find("city of splendour",2026,"episode").trakt,289996);
assert.equal(registry.find("City of Splendour",2019,"episode"),null);
assert.equal(registry.find("City of Splendour",null,"movie"),null);
assert.equal(registry.find("City of Splendours",null,"episode"),null);
const a=registry.learn([],target);
const restored=registry.read(registry.encode(a));
assert.equal(registry.find("The Other Name",2025,"episode",restored,
 "https://cdn.example/video/index.m3u8").tmdb,22222);
assert.equal(registry.find("The Other Name",2025,"episode",restored,
 "https://other.example/video/index.m3u8"),null);
assert.equal(registry.find("The Other Name",2026,"episode",restored,
 "https://cdn.example/video/index.m3u8"),null);
assert.equal(registry.find("The Other Name",null,"episode",restored,
 "https://evilcdn.example/video/index.m3u8"),null);
assert.equal(registry.read('{"version":0,"records":[]}').length,0);
assert.equal(registry.read('not json').length,0);
const contradiction=[target,row("The Other Name",2025,"tt22222222",33333,"cdn.example")];
assert.equal(registry.find("The Other Name",2025,"episode",contradiction,
 "https://cdn.example/stream"),null,"Conflicting trusted identities fail closed");
const updated=registry.learn(restored,row("The Other Name",2025,"tt22222222",33333,"cdn.example"));
assert.equal(updated.length,1,"Explicit user confirmation replaces prior saved mapping");
assert.equal(registry.find("The Other Name",2025,"episode",updated,
 "https://cdn.example/stream").tmdb,33333);
const years=[target,row("The Other Name",2023,"tt33333333",44444,"cdn.example")];
assert.equal(registry.find("The Other Name",null,"episode",years,
 "https://cdn.example/stream"),null,"Without year, two distinct shows are ambiguous");
assert.equal(registry.find("The Other Name",2025,"episode",years,
 "https://cdn.example/stream").tmdb,22222);
const epUnknown=row("Name Without IMDB",2025,"",999,"cdn.example");
assert.throws(()=>registry.learn([],epUnknown),/invalid/);
assert.equal(registry.find("City of Splendour",2026,"episode",
 [row("City of Splendour",2026,"tt39443161",295002,"cdn.example")],
 "https://cdn.example/video").trakt,289996,
 "A compatible learned TMDb-only mapping must not conflict with known Trakt ID");
console.log("Identity framework: scope, persistence, ambiguity and trusted IDs PASS");