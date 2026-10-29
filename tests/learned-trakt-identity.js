"use strict";
const assert=require("node:assert/strict"),path=require("node:path");
const TOKEN="@data/trakt-token.json",CACHE="@data/trakt-cache.json";
const LEARNED="@data/verified-title-mappings.json";
const media={type:"episode",showTitle:"Alternate Crown",title:"Alternate Crown",
 year:null,season:1,episode:2,episodeTitle:"Episode 2",sourceHost:"cdn.example"};
const canonical={title:"The Real Crown",year:2025,
 ids:{trakt:555001,tmdb:555002,imdb:"tt12345678"}};
function boot(store) {
 delete require.cache[path.resolve(__dirname,"../trakt.js")];
 const trakt=require("../trakt.js"),calls=[];
 trakt.configure({
  file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>{store[k]=String(v)}},
  logger(){},notify(){},preferences:{get(){return undefined;}},
  apiGate:{request:(_m,fn)=>fn(),status:()=>({mode:"online"})},
  utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
   async exec(_program,args){
    const url=new URL(args[args.length-1]),method=args[args.indexOf("-X")+1];
    calls.push(method+" "+url.pathname);
    assert.equal(method,"GET","No scrobble writes in identity verification");
    let body={};
    if(url.pathname==="/search/show")body=[];
    else if(url.pathname==="/shows/555001"||url.pathname==="/shows/tt12345678")body=canonical;
    else if(/^\/shows\/555001\/seasons\/1\/episodes\/[23]$/.test(url.pathname)){
      const n=Number(url.pathname.split("/").pop());
      body={season:1,number:n,title:"Episode "+n};
    }else throw Error("Unexpected "+url.pathname);
    return {status:0,stderr:"",stdout:JSON.stringify(body)+"\n__IINA_TRAKT_STATUS__:200"};
   }}
 });
 return {trakt,calls};
}
(async()=>{
 const store={[TOKEN]:JSON.stringify({access_token:"dummy",refresh_token:"dummy",
  created_at:Math.floor(Date.now()/1000),expires_in:3600})};
 const plugin=boot(store);
 assert.deepEqual(await plugin.trakt.applyMatchOverride(media,555001),{trakt:555001});
 const saved=JSON.parse(store[LEARNED]);
 assert.equal(saved.version,1);
 assert.equal(saved.records.length,1);
 assert.equal(saved.records[0].alias,"Alternate Crown");
 assert.equal(saved.records[0].canonicalTitle,"The Real Crown");
 assert.equal(saved.records[0].originHost,"cdn.example");
 // Remove show cache to ensure the NEXT episode truly resolves using the
 // learned registry, not old in-memory/manual v2 cache.
 const cache=JSON.parse(store[CACHE]);
 cache.show={};store[CACHE]=JSON.stringify(cache);
 // Fresh module instance loads persisted file rather than cached state.
 const next=boot(store);
 assert.deepEqual(await next.trakt.getTraktIds({...media,episode:3,
  episodeTitle:"Episode 3"}),{trakt:555001},
  "User confirmed once, next episode should match automatically");
 const away=boot({...store,[CACHE]:JSON.stringify({movie:{},show:{}})});
 assert.equal(await away.trakt.getTraktIds({...media,episode:3,
  episodeTitle:"Episode 3",sourceHost:"other.example"}),null,
  "A learned alias from another stream host must not be automatically trusted");
 console.log("Trakt one-time manual confirmation => next-episode reviewed auto-ID PASS");
})().catch(e=>{console.error(e);process.exitCode=1});