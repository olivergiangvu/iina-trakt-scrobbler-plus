"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const TOKEN="@data/trakt-token.json",CACHE="@data/trakt-cache.json";
const title="Fired Up!";
const oldShow={score:20,show:{title:"Fired Up",year:1997,
  ids:{trakt:199700,imdb:"tt0118317",tmdb:199700}}};
const newShow={score:20,show:{title:"Fired Up!",year:2026,
  ids:{trakt:239156,imdb:"tt29932775",tmdb:239156}}};
const base={type:"episode",title,showTitle:title,year:null,season:1,episode:7,
  episodeTitle:"Episode 7",durationSeconds:37*60+51,
  sourceHost:"akm-cdn-play.hitv.ltd"};
function boot({runtimes={199700:30,239156:38},candidates=[oldShow,newShow]}={}){
  delete require.cache[path.resolve(__dirname,"../trakt.js")];
  const trakt=require("../trakt.js"),calls=[],store={
    [TOKEN]:JSON.stringify({access_token:"test",refresh_token:"test",
      created_at:Math.floor(Date.now()/1000),expires_in:3600})
  };
  trakt.configure({
    file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>{store[k]=String(v)}},
    preferences:{get(){return undefined;}},logger(){},notify(){},
    apiGate:{request:(_method,run)=>run(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args){
        const method=args[args.indexOf("-X")+1],url=new URL(args[args.length-1]);
        calls.push({method,path:url.pathname,extended:url.searchParams.get("extended")});
        assert.equal(method,"GET","Auto-identity must never send a scrobble write");
        let body=[],status=200;
        if(url.pathname==="/search/show")body=candidates;
        else if(url.pathname==="/sync/playback/episodes")body=[];
        else {
          const found=/^\/shows\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(url.pathname);
          if(!found)throw Error("Unexpected Trakt endpoint "+url.pathname);
          assert.equal(url.searchParams.get("extended"),"full",
            "Runtime proof needs Trakt's full episode metadata");
          const id=Number(found[1]),number=Number(found[3]);
          if(!(id in runtimes)){status=404;body={};}
          else body={season:1,number,title:"Episode "+number,runtime:runtimes[id]};
        }
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:"+status};
      }}
  });
  return {trakt,calls,store};
}
(async()=>{
  const typical=boot();
  assert.deepEqual(await typical.trakt.getTraktIds(base),{trakt:239156},
    "37:51 must choose the verified 2026 episode over a 30m 1997 sitcom");
  const cached=JSON.parse(typical.store[CACHE]).show;
  assert.equal(cached["fired up!|"].source,"episode-runtime");
  assert.equal(cached["fired up!|"].episode,7);
  assert.equal(cached["fired up!|"].runtimeSeconds,2271);
  const reads=typical.calls.length;
  assert.deepEqual(await typical.trakt.getTraktIds(base),{trakt:239156});
  assert.equal(typical.calls.length,reads,"Exact verified runtime/S-E cache can be reused");
  assert.deepEqual(await typical.trakt.getResumeCheckpoint(base),{
    status:"ok",progress:null,traktId:239156},
    "Read-only resume must resolve the same independently verified Trakt show");
  assert.deepEqual(await typical.trakt.getTraktIds({...base,durationSeconds:1800}),
    {trakt:199700},"Same CDN/title/S-E but 30m video must invalidate the 2026 cache");
  assert.deepEqual(await typical.trakt.getTraktIds({...base,episode:8,durationSeconds:2271}),
    {trakt:239156},"Next episode must be independently reverified");

  const noLength=boot();
  assert.equal(await noLength.trakt.getTraktIds({...base,durationSeconds:0}),null,
    "No player duration is not enough to disambiguate multiple same-name shows");
  assert.equal(await boot({runtimes:{199700:0,239156:38}}).trakt.getTraktIds(base),null,
    "Unknown competing episode runtime cannot be assumed incompatible");
  assert.equal(await boot({runtimes:{199700:36,239156:38}}).trakt.getTraktIds(base),null,
    "Two close episode runtimes must stay unresolved");
  assert.deepEqual(await boot().trakt.getTraktIds({...base,year:2026,durationSeconds:0}),
    {trakt:239156},"An explicitly supplied 2026 release year is independent evidence");

  // Test live IINA resume check deferral: first file-loaded event can fire
  // before mpv knows duration. It must retry when playback duration arrives.
  const source=fs.readFileSync(path.resolve(__dirname,"../main.js"),"utf8");
  const start=source.indexOf("function beginResumeCheck(target) {");
  const end=source.indexOf("function restoreRemoteResume()",start);
  assert(start>=0&&end>start);
  let resumeReads=0;
  const target={mediaInfo:{...base,durationSeconds:0},freshState:""};
  const context=vm.createContext({
    core:{status:{duration:0}},currentMedia:target,
    resumeProtection:{create:()=>({update(){},decision:()=>({blocked:false}),snapshot:()=>({})})},
    queueSidebarRefresh(){},log(){},
    trakt:{async getResumeCheckpoint(media){resumeReads++;assert.equal(media.durationSeconds,2271);
      return {status:"ok",traktId:239156,progress:null};}},
    currentResumeStatus:()=>({status:"ready",blocked:false,message:"ok"}),
    resyncCurrentPlayback(){},
    Number,Math,Date
  });
  vm.runInContext(source.slice(start,end),context);
  context.beginResumeCheck(target);
  assert.equal(target.resumeAwaitingDuration,true);
  assert.equal(resumeReads,0,"No premature yearless Trakt identity lookup");
  context.core.status.duration=2271;
  context.beginResumeCheck(target);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(target.resumeAwaitingDuration,false);
  assert.equal(resumeReads,1,"Read-only resume triggered after actual runtime arrived");
  assert(source.includes("if(currentMedia.resumeAwaitingDuration && currentSnapshot.duration>=120)"),
    "Live IINA events must retry a duration-pending resume gate");
  console.log("Fired Up! Trakt exact runtime/Cache/Resume 1997 vs 2026 PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
