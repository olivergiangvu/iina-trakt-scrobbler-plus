"use strict";
const assert=require("node:assert/strict");
const path=require("node:path");
const registry=require("../trusted-series-aliases.js");
const TOKEN="@data/trakt-token.json",CACHE="@data/trakt-cache.json";
const media={type:"episode",title:"City Of Splendour",showTitle:"City Of Splendour",
  season:1,episode:2,episodeTitle:"Episode 2",year:null};
const official={title:"This City Never Sleeps",year:2026,
 ids:{imdb:"tt39443161",tmdb:295002,trakt:289996}};
function setup({show=official,episodeFound=true}={}) {
 delete require.cache[path.resolve(__dirname,"../trakt.js")];
 const trakt=require("../trakt.js");
 const files={[TOKEN]:JSON.stringify({access_token:"dummy",refresh_token:"dummy",
  created_at:Math.floor(Date.now()/1000),expires_in:3600})};
 const calls=[];
 trakt.configure({
  file:{exists:k=>Object.hasOwn(files,k),read:k=>files[k],
   write:(k,v)=>{files[k]=String(v)}},
  logger(){},notify(){},preferences:{get(){return undefined;}},
  apiGate:{request:(_method,run)=>run(),status:()=>({mode:"online"})},
  utils:{keyChainRead(){return ""},keyChainWrite(){return true},
   async exec(_exe,args) {
    const method=args[args.indexOf("-X")+1],url=new URL(args[args.length-1]);
    calls.push(method+" "+url.pathname);
    assert.equal(method,"GET","Identity proof must never POST scrobbles");
    let code=200,body={};
    if(url.pathname==="/search/show")body=[];
    else if(url.pathname==="/shows/tt39443161")body=show;
    else if(url.pathname==="/shows/289996/seasons/1/episodes/2"){
      if(episodeFound)body={season:1,number:2,title:"Episode 2"};
      else{code=404;body={};}
    }else throw Error("Unexpected "+url.pathname);
    return {status:0,stderr:"",
      stdout:JSON.stringify(body)+"\n__IINA_TRAKT_STATUS__:"+code};
   }
  }
 });
 return {trakt,files,calls};
}
(async function(){
 assert.equal(registry.find("City of Splendour",null,"episode").imdb,"tt39443161");
 assert.equal(registry.find("City of Splendour",2024,"episode"),null);
 assert.equal(registry.find("City of Splendors",null,"episode"),null);
 assert.equal(registry.find("City of Splendour",null,"movie"),null);
 const ok=setup();
 assert.deepEqual(await ok.trakt.getTraktIds(media),{trakt:289996});
 const v=JSON.parse(ok.files[CACHE]).show["city of splendour|"];
 assert.equal(v.source,"reviewed-alias");
 assert.equal(v.trakt,289996);
 assert.equal(v.imdb,"tt39443161");
 assert.equal(v.identityVersion,2);
 const n=ok.calls.length;
 assert.deepEqual(await ok.trakt.getTraktIds(media),{trakt:289996});
 assert.equal(ok.calls.length,n,"Second lookup may reuse validated cache");
 assert.equal(await setup({show:{...official,ids:{...official.ids,trakt:289995}}}).trakt.getTraktIds(media),null);
 assert.equal(await setup({show:{...official,year:2023}}).trakt.getTraktIds(media),null);
 assert.equal(await setup({show:{...official,ids:{...official.ids,tmdb:111}}}).trakt.getTraktIds(media),null);
 assert.equal(await setup({episodeFound:false}).trakt.getTraktIds(media),null);
 assert.equal(await setup().trakt.getTraktIds({...media,year:2020}),null,
   "Conflicting playback year must not use reviewed alias");
 console.log("Cross-catalog HLS auto-ID, year/IDs/S-E validation, no guessing, cache v2 PASS");
})().catch(e=>{console.error(e);process.exitCode=1});
