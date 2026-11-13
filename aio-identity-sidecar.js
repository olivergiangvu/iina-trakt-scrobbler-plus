"use strict";
// Read-only consumer for the existing AIOIINABridge.app identity sidecar.
// No network requests, writes, listeners, Trakt calls, or signed URL logging.
const DIR="~/Library/Application Support/AIO-IINA-Bridge/identity";
const SETTINGS="~/Library/Application Support/AIO-IINA-Bridge/identity-settings.json";
const MAX_RECORD_BYTES=4096, MAX_ROWS=64, MAX_AGE_MS=300000;

const K=[
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function rotr(x,n){return (x>>>n)|(x<<(32-n));}
function sha256(value){
  if(typeof value!=="string"||value.length>16384)return "";
  let binary;try{binary=unescape(encodeURIComponent(value));}catch(_){return "";}
  const n=binary.length,bytes=[];
  for(let i=0;i<n;i++)bytes.push(binary.charCodeAt(i));
  bytes.push(0x80);
  while(bytes.length%64!==56)bytes.push(0);
  const high=Math.floor(n/0x20000000),low=(n*8)>>>0;
  for(const u of [high,low])for(let k=3;k>=0;k--)bytes.push((u>>>(8*k))&255);
  const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w=new Array(64);
  for(let base=0;base<bytes.length;base+=64){
    for(let j=0;j<16;j++){
      const p=base+j*4;w[j]=((bytes[p]<<24)|(bytes[p+1]<<16)|(bytes[p+2]<<8)|bytes[p+3])>>>0;
    }
    for(let j=16;j<64;j++){
      const a=w[j-15],b=w[j-2];
      const x=rotr(a,7)^rotr(a,18)^(a>>>3);
      const y=rotr(b,17)^rotr(b,19)^(b>>>10);
      w[j]=(w[j-16]+x+w[j-7]+y)>>>0;
    }
    let [a,b,c,d,e,f,g,h]=H;
    for(let j=0;j<64;j++){
      const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[j]+w[j])>>>0;
      const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    for(let j=0;j<8;j++)H[j]=(H[j]+[a,b,c,d,e,f,g,h][j])>>>0;
  }
  return H.map(x=>x.toString(16).padStart(8,"0")).join("");
}
function validOrigin(s){
  return typeof s==="string"&&/^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(s)&&
    !s.includes("..")&&s.length<=255;
}
function positiveId(v){
  const x=Number(v);return Number.isSafeInteger(x)&&x>0&&x<=999999999?x:0;
}
function asIdentity(row,origin,digest,now){
  if(!row||row.schema!==1||row.kind!=="episode"||
    row.provenance!=="authenticated-aiostreams-item"||row.origin!==origin||
    row.media_sha256!==digest)return null;
  const issued=row.issued_at_ms,expires=row.expires_at_ms;
  if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
    issued>now+30000||issued<now-MAX_AGE_MS||
    expires<=now||expires>issued+MAX_AGE_MS||expires<=issued)return null;
  const season=Number(row.season),episode=Number(row.episode),year=Number(row.year);
  if(!Number.isInteger(season)||season<0||season>100||
    !Number.isInteger(episode)||episode<1||episode>9999||
    !Number.isInteger(year)||year<1900||year>2100||
    !/^[a-zA-Z0-9-]{8,128}$/.test(String(row.item_id||""))||
    !/^[a-zA-Z0-9-]{8,128}$/.test(String(row.series_id||""))||
    !/^[a-zA-Z0-9-]{8,128}$/.test(String(row.media_source_id||"")))return null;
  const imdb=String(row.ids&&row.ids.imdb||"").toLowerCase();
  const tmdb=positiveId(row.ids&&row.ids.tmdb);
  if(imdb&&!/^tt\d{6,10}$/.test(imdb))return null;
  if(!imdb&&!tmdb)return null;
  const name=String(row.canonical_title||"").trim();
  if(!name||name.length>160)return null;
  return {kind:"episode",season,episode,year,imdb,tmdb,
    canonicalTitle:name,origin,provenance:"authenticated-aiostreams-item",
    issuedAt:issued};
}
function find(deps,source,nowMs){
  const io=deps&&deps.file,resolve=deps&&deps.resolvePath;
  if(!io||typeof io.read!=="function"||typeof io.list!=="function"||
    typeof resolve!=="function")return null;
  const urls=[String(source&&source.url||""),String(source&&source.path||"")]
    .filter(function(v){return /^https?:\/\//i.test(v)&&v.length<=16384;});
  const digests=[...new Set(urls.map(sha256).filter(Boolean))];
  if(!digests.length)return null;
  const now=Number.isFinite(nowMs)?nowMs:Date.now();
  try{
    const base=resolve(DIR),settings=resolve(SETTINGS);
    if(!base||!settings||!base.startsWith("/")||!settings.startsWith("/"))return null;
    const configRaw=io.read(settings);
    if(typeof configRaw!=="string"||configRaw.length>1024)return null;
    const config=JSON.parse(configRaw);
    if(!config||config.enabled!==true||!validOrigin(config.origin))return null;
    const entries=io.list(base,{includeSubDir:false});
    if(!Array.isArray(entries)||entries.length>MAX_ROWS)return null;
    let match=null;
    for(const row of entries){
      if(!row||row.isDir||!/^identity-[a-f0-9]{32}\.json$/.test(row.filename||""))continue;
      const full=base+"/"+row.filename;
      const raw=io.read(full);
      if(typeof raw!=="string"||raw.length>MAX_RECORD_BYTES)continue;
      const parsed=JSON.parse(raw);
      const candidate=digests.map(function(d){return asIdentity(parsed,config.origin,d,now);})
        .filter(Boolean)[0]||null;
      if(!candidate)continue;
      if(match&&(match.imdb!==candidate.imdb||match.tmdb!==candidate.tmdb||
        match.season!==candidate.season||match.episode!==candidate.episode||
        match.year!==candidate.year||match.canonicalTitle!==candidate.canonicalTitle))
        return null; // Two different claims for ONE signed URL: fail closed.
      match=candidate;
    }
    return match;
  }catch(_){return null;}
}
module.exports={sha256,find,asIdentity,validOrigin};
