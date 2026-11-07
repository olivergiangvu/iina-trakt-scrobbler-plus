"use strict";
// Shared resolver contract used by IINA Trakt+ and Episode Info+.
// Sources are either independently reviewed cross-catalog entries or
// user-confirmed entries that must be rechecked against remote APIs.
// A title similarity score NEVER acts as proof of identity.
const RECORDS=Object.freeze([Object.freeze({
  kind:"episode",alias:"City of Splendour",canonicalTitle:"This City Never Sleeps",
  year:2026,imdb:"tt39443161",tmdb:295002,trakt:289996,tvdb:483239,
  evidence:"https://www.thetvdb.com/series/483239",source:"reviewed"
})]);
function norm(value){
  return String(value||"").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/&/g," and ").replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function hostOf(url){
  const m=/^https?:\/\/([^/?#:]+)(?::\d+)?(?:[/?#]|$)/i.exec(String(url||""));
  return m?m[1].toLowerCase():"";
}
function goodYear(x){return Number.isInteger(Number(x))&&Number(x)>=1900&&Number(x)<=2100;}
function valid(row){
  return !!(row&&row.kind==="episode"&&
    typeof row.alias==="string"&&norm(row.alias).length>=6&&
    typeof row.canonicalTitle==="string"&&norm(row.canonicalTitle).length>=3&&
    goodYear(row.year)&&/^tt\d{6,10}$/.test(String(row.imdb||"").toLowerCase())&&
    Number.isSafeInteger(Number(row.tmdb))&&Number(row.tmdb)>0&&
    Number.isSafeInteger(Number(row.trakt||0))&&Number(row.trakt||0)>=0&&
    (row.source==="reviewed"||row.source==="user-confirmed")&&
    (row.source==="reviewed"||typeof row.originHost==="string"));
}
function clean(row){
  if(!valid(row))return null;
  const host=row.source==="user-confirmed"?hostOf("https://"+row.originHost):"";
  if(row.source==="user-confirmed"&&!host)return null;
  return {kind:"episode",alias:row.alias,canonicalTitle:row.canonicalTitle,
    year:Number(row.year),imdb:String(row.imdb).toLowerCase(),tmdb:Number(row.tmdb),
    trakt:Number(row.trakt||0),source:row.source,originHost:host,
    evidence:String(row.evidence||"").slice(0,160)};
}
function find(title,year,kind,extra,originHost){
  if(kind!=="episode")return null;
  const key=norm(title),requestedYear=Number(year||0);
  if(key.length<6||(requestedYear&&!goodYear(requestedYear)))return null;
  const host=hostOf(originHost||"");
  const found=RECORDS.concat(Array.isArray(extra)?extra:[]).map(clean)
    .filter(r=>r&&norm(r.alias)===key&&(!requestedYear||r.year===requestedYear)&&
      (r.source!=="user-confirmed"||(host&&r.originHost===host)));
  if(!found.length)return null;
  // A learned TMDb record may not know a Trakt ID yet; zero is unknown,
  // never a competing ID. Every KNOWN identifier must agree.
  const first=found[0];
  if(found.some(r=>r.imdb!==first.imdb||r.tmdb!==first.tmdb||
     r.year!==first.year||(r.trakt>0&&first.trakt>0&&r.trakt!==first.trakt)))
    return null;
  return {...(found.find(r=>r.source==="reviewed")||first)};
}
function read(raw){
  let parsed;try{parsed=typeof raw==="string"?JSON.parse(raw):raw;}catch{return [];}
  if(!parsed||parsed.version!==1||!Array.isArray(parsed.records))return [];
  return parsed.records.slice(0,200).map(clean).filter(r=>r&&r.source==="user-confirmed");
}
function learn(records,row){
  const item=clean({...row,source:"user-confirmed"});
  if(!item)throw Error("Cannot store an unverified/invalid show mapping");
  const current=(Array.isArray(records)?records:[]).map(clean)
    .filter(r=>r&&r.source==="user-confirmed"&&
       !(norm(r.alias)===norm(item.alias)&&r.originHost===item.originHost));
  current.push(item);
  return current.slice(-200);
}
function encode(records){return JSON.stringify({version:1,records:(records||[]).map(clean).filter(Boolean)});}
module.exports={find,read,learn,encode,norm,hostOf,valid,records:RECORDS};
