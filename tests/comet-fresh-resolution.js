const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const fresh=require("../fresh-identity.js");

// Exercise the actual production resolver body with fake read-only Trakt lookups.
// No real HTTP requests, stream URL access, tokens, or scrobble writes.
const code=fs.readFileSync(path.join(__dirname,"../trakt.js"),"utf8");
const start=code.indexOf("async function resolveFreshIdentity(external) {");
const end=code.indexOf("\n// READ-ONLY preflight",start);
assert.ok(start>=0&&end>start,"Trakt resolver source must exist");
const source=code.slice(start,end);
let verifiedEpisodes=[];
const canonical={title:"Better Call Saul",year:2017,ids:{
  trakt:2604,imdb:"tt3032476",tmdb:60059}};
const resolve=new Function(
  "fetchShowByReference","fetchMovieByReference","lookupTmdbByType",
  "verifyEpisodeCandidate","titleIdentityMatches",
  source+"\nreturn resolveFreshIdentity;"
)(
  async id=>id==="tt3032476"?canonical:null,
  async()=>null,
  async()=>null,
  async (id,info)=>{
    verifiedEpisodes.push({id,season:info.season,episode:info.episode});
    if(id!==2604||info.season!==3||info.episode!==3)return null;
    return {episode:{title:"Sunk Costs"}};
  },
  (a,b)=>String(a||"").trim().toLowerCase()===String(b||"").trim().toLowerCase()
);
const withoutPosition={conflict:false,kind:"episode",imdb:"tt3032476",
  tmdb:0,season:null,episode:null};
const recognized={kind:"episode",showTitle:"Better Call Saul",season:3,episode:3};
(async()=>{
  assert.equal(await resolve(withoutPosition),null,
    "must never verify a show-level ID without S/E");
  const recovered=fresh.completeEpisodePosition(withoutPosition,recognized);
  const matched=await resolve(recovered);
  assert.ok(matched);
  assert.equal(matched.kind,"episode");
  assert.equal(matched.title,"Better Call Saul");
  assert.equal(matched.trakt,2604);
  assert.equal(matched.season,3);
  assert.equal(matched.episode,3);
  assert.equal(matched.episodeTitle,"Sunk Costs");
  assert.deepEqual(verifiedEpisodes,[{id:2604,season:3,episode:3}]);

  const wrongTitle=fresh.completeEpisodePosition(withoutPosition,{
    kind:"episode",showTitle:"Entirely Different Series",season:3,episode:3
  });
  assert.equal(await resolve(wrongTitle),null,
    "an explicit IMDb show ID with unrelated filename title must not scrobble");
  assert.equal(verifiedEpisodes.length,1,
    "wrong show title must be rejected before episode verification");

  const wrongEpisode=fresh.completeEpisodePosition(withoutPosition,{
    kind:"episode",showTitle:"Better Call Saul",season:3,episode:4
  });
  assert.equal(await resolve(wrongEpisode),null,
    "unavailable episode must fail closed");
  assert.equal(verifiedEpisodes.length,2);

  const conflict=fresh.completeEpisodePosition(Object.assign({},withoutPosition,
    {season:2,episode:3}),recognized);
  assert.equal(conflict.conflict,true);
  assert.equal(await resolve(conflict),null,
    "a provider/filename S/E disagreement must not be resolved");
  console.log("Comet trusted series+filename position+Trakt verification PASS");
})().catch(error=>{console.error(error);process.exitCode=1;});
