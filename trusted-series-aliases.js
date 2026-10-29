"use strict";
// Reviewed cross-catalog aliases. This is *not* fuzzy title search.
// A record is added only after an independent source attests the alias,
// and canonical IMDb/TMDb/Trakt IDs are verified against the same show.
// Failing/ambiguous/missing registry entries must fail closed.
const RECORDS = Object.freeze([
  Object.freeze({
    kind:"episode",
    alias:"City of Splendour",
    canonicalTitle:"This City Never Sleeps",
    year:2026,
    imdb:"tt39443161",
    tmdb:295002,
    trakt:289996,
    tvdb:483239,
    evidence:"https://www.thetvdb.com/series/483239"
  })
]);
function norm(value) {
  return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/&/g," and ").replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function find(title,year,kind) {
  if(kind!=="episode")return null;
  const key=norm(title);
  if(!key||key.length<6)return null;
  const knownYear=Number(year||0);
  if(knownYear&&(knownYear<1900||knownYear>2100||!Number.isInteger(knownYear)))return null;
  const found=RECORDS.filter(r=>norm(r.alias)===key &&
    (!knownYear||r.year===knownYear));
  // Never select first of conflicting trusted entries.
  return found.length===1 ? {...found[0]} : null;
}
module.exports={find,records:RECORDS};
