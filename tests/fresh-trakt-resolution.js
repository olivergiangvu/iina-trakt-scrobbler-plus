const assert=require("node:assert/strict");
const path=require("node:path");
const TOKEN="@data/trakt-token.json";
function setup(handler){
  delete require.cache[path.resolve(__dirname,"../trakt.js")];
  const trakt=require("../trakt.js"),calls=[];
  const stored={[TOKEN]:JSON.stringify({access_token:"abc",refresh_token:"refresh",
    created_at:Math.floor(Date.now()/1000),expires_in:3600})};
  trakt.configure({
    file:{exists:k=>Object.hasOwn(stored,k),read:k=>stored[k],write:(k,v)=>stored[k]=v},
    preferences:{get(){return undefined;}},logger(){},notify(){},
    apiGate:{request:(_method,send)=>send(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args){
        const url=new URL(args[args.length-1]);
        calls.push(url.pathname+"?"+url.searchParams.toString());
        const r=handler(url);return {status:0,stderr:"",stdout:JSON.stringify(r.body)+
          "\n__IINA_TRAKT_STATUS__:"+r.statusCode};
      }
    }
  });
  return {trakt,calls};
}
const goodShow={title:"The Legend of Vox Machina",year:2022,
  ids:{trakt:4242,imdb:"tt11247158",tmdb:135934}};
const episode={title:"The Echo Tree",season:2,number:8};
(async function(){
  let s=setup(url=>{
    if(url.pathname==="/shows/tt11247158")return {statusCode:200,body:goodShow};
    if(url.pathname==="/shows/4242/seasons/2/episodes/8")return {statusCode:200,body:episode};
    throw Error("Unexpected "+url.pathname);
  });
  const q={kind:"episode",imdb:"tt11247158",season:2,episode:8};
  let resolved=await s.trakt.resolveFreshIdentity(q);
  assert.equal(resolved.title,"The Legend of Vox Machina");
  assert.equal(resolved.episodeTitle,"The Echo Tree");
  assert.equal(resolved.trakt,4242);
  assert.equal(resolved.source,"verified-imdb");
  assert.equal(s.calls.length,2,"one show and one episode verification; no title search");
  s=setup(url=>{
    if(url.pathname==="/search/tmdb/135934") {
      assert.equal(url.searchParams.get("type"),"show");
      return {statusCode:200,body:[{type:"show",show:goodShow}]};
    }
    if(url.pathname==="/shows/4242/seasons/2/episodes/8")return {statusCode:200,body:episode};
    throw Error("Unexpected "+url.pathname);
  });
  resolved=await s.trakt.resolveFreshIdentity({kind:"episode",tmdb:135934,season:2,episode:8});
  assert.equal(resolved.source,"verified-tmdb");
  assert.equal(s.calls.length,2);

  s=setup(url=>{
    if(url.pathname==="/shows/tt11247158")return {statusCode:200,body:goodShow};
    if(url.pathname==="/search/tmdb/90000")return {statusCode:200,body:[
      {type:"show",show:{title:"Unrelated Show",ids:{trakt:3333,tmdb:90000}}}
    ]};
    throw Error("Unexpected "+url.pathname);
  });
  assert.equal(await s.trakt.resolveFreshIdentity({
    kind:"episode",imdb:"tt11247158",tmdb:90000,season:2,episode:8
  }),null,"conflicting IDs rejected before episode request");
  assert.equal(s.calls.length,2);

  s=setup(url=>{
    if(url.pathname==="/shows/tt11247158")return {statusCode:200,body:goodShow};
    if(url.pathname==="/shows/4242/seasons/2/episodes/99")return {statusCode:404,body:{}};
    throw Error("Unexpected "+url.pathname);
  });
  assert.equal(await s.trakt.resolveFreshIdentity({
    kind:"episode",imdb:"tt11247158",season:2,episode:99
  }),null,"nonexistent episode is rejected");

  s=setup(()=>{throw Error("No network calls expected");});
  assert.equal(await s.trakt.resolveFreshIdentity({kind:"episode",imdb:"tt11247158",season:2}),null);
  assert.equal(await s.trakt.resolveFreshIdentity({kind:"episode",conflict:true,imdb:"tt11247158",season:2,episode:8}),null);
  assert.equal(s.calls.length,0);

  const goodMovie={title:"A Sample Movie",year:2026,
    ids:{trakt:999,imdb:"tt12345678",tmdb:543210}};
  s=setup(url=>{
    if(url.pathname==="/movies/tt12345678")return {statusCode:200,body:goodMovie};
    throw Error("Unexpected "+url.pathname);
  });
  resolved=await s.trakt.resolveFreshIdentity({kind:"movie",imdb:"tt12345678"});
  assert.deepEqual({kind:resolved.kind,title:resolved.title,trakt:resolved.trakt},
    {kind:"movie",title:"A Sample Movie",trakt:999});

  s=setup(url=>{
    if(url.pathname==="/search/tmdb/135934")return {statusCode:200,body:[]};
    throw Error("Unexpected "+url.pathname);
  });
  assert.equal(await s.trakt.resolveFreshIdentity({kind:"episode",tmdb:135934,season:2,episode:8}),null,
    "Trakt missing TMDB mapping never falls back to text-title guess");
  // Real-world Comet regression: the URL contains a series IMDb ID while
  // a separate readable filename provides S/E. Still verify both on Trakt.
  const fresh=require("../fresh-identity.js");
  const coordinated=fresh.coordinateEpisode(
    {conflict:false,kind:"episode",imdb:"tt3032476",tmdb:0,season:null,episode:null},
    {kind:"episode",showTitle:"Better Call Saul",season:3,episode:3});
  assert.equal(coordinated.conflict,false);
  const betterCallSaul={title:"Better Call Saul",year:2015,
    ids:{trakt:3032,imdb:"tt3032476",tmdb:60059}};
  s=setup(url=>{
    if(url.pathname==="/shows/tt3032476")
      return {statusCode:200,body:betterCallSaul};
    if(url.pathname==="/shows/3032/seasons/3/episodes/3")
      return {statusCode:200,body:{title:"Sunk Costs",season:3,number:3}};
    throw Error("Unexpected Comet mock call "+url.pathname);
  });
  resolved=await s.trakt.resolveFreshIdentity(coordinated.external);
  assert.equal(resolved.kind,"episode");
  assert.equal(resolved.imdb,"tt3032476");
  assert.equal(resolved.season,3);
  assert.equal(resolved.episode,3);
  assert.equal(resolved.title,"Better Call Saul");
  assert.ok(fresh.titlesAgree(coordinated.external.expectedShowTitle,resolved.title));
  assert.equal(s.calls.length,2,"exact show + episode verification, no title search");
  assert.equal(fresh.titlesAgree("Better Call Saul","Breaking Bad"),false,
    "Wrong IMDb show must never unlock scrobbling");

  console.log("Fresh external ID verification and fail-closed regression tests PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});