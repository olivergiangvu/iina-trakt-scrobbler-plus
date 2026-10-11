const assert=require("node:assert/strict");
const path=require("node:path");
const TOKEN="@data/trakt-token.json";
function setup(handler) {
  delete require.cache[path.resolve(__dirname,"../trakt.js")];
  const trakt=require("../trakt.js"),calls=[],store={
    [TOKEN]:JSON.stringify({access_token:"t",refresh_token:"r",expires_in:3600,
      created_at:Math.floor(Date.now()/1000)})
  };
  trakt.configure({
    file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>store[k]=v},
    preferences:{get(){return undefined;}},logger(){},notify(){},
    apiGate:{request:(_m,send)=>send(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args){
        const method=args[args.indexOf("-X")+1],url=new URL(args[args.length-1]);
        calls.push(method+" "+url.pathname);
        const r=handler(method,url);
        return {status:0,stderr:"",stdout:JSON.stringify(r.body)+
          "\n__IINA_TRAKT_STATUS__:"+r.status};
      }
    }
  });
  return {trakt,calls};
}
const current={type:"episode",title:"The Legend of Vox Machina",
 showTitle:"The Legend of Vox Machina",season:2,episode:9,manualTraktId:4242};
const checkpoints=[
 {id:111,type:"episode",progress:70.25,show:{ids:{trakt:4242}},
  episode:{season:2,number:9,title:"Test of Pride"}},
 {id:112,type:"episode",progress:95,show:{ids:{trakt:4242}},
  episode:{season:2,number:8}},
 {id:113,type:"episode",progress:89,show:{ids:{trakt:9999}},
  episode:{season:2,number:9}},
 {id:114,type:"episode",progress:72.1,show:{ids:{trakt:4242}},
  episode:{season:2,number:9}}
];
(async()=>{
 const s=setup((method,url)=>{
   if(method==="GET"&&url.pathname==="/shows/4242/seasons/2/episodes/9")
     return {status:200,body:{title:"Test of Pride",season:2,number:9}};
   if(method==="GET"&&url.pathname==="/sync/playback/episodes")
     return {status:200,body:checkpoints};
   throw Error("Unexpected API "+method+" "+url.pathname);
 });
 const result=await s.trakt.getResumeCheckpoint(current);
 assert.equal(result.status,"ok");
 assert.equal(result.progress,72.1);
 assert.deepEqual(s.calls,[
  "GET /shows/4242/seasons/2/episodes/9","GET /sync/playback/episodes"]);
 assert.equal(s.calls.some(x=>x.startsWith("POST")),false,"preflight is read-only");
 const movie={type:"movie",title:"An Example",manualTraktId:999};
 const m=setup((method,url)=>{
   if(url.pathname==="/movies/999")return {status:200,body:{title:"An Example",ids:{trakt:999}}};
   if(url.pathname==="/sync/playback/movies")return {status:200,body:[
    {progress:42,movie:{ids:{trakt:999}}},
    {progress:97,movie:{ids:{trakt:998}}}
   ]};
   throw Error("Unexpected "+url.pathname);
 });
 assert.equal((await m.trakt.getResumeCheckpoint(movie)).progress,42);
 const noResume=setup((method,url)=>{
   if(url.pathname==="/shows/4242/seasons/2/episodes/9")
     return {status:200,body:{title:"Test of Pride",season:2,number:9}};
   if(url.pathname==="/sync/playback/episodes")return {status:200,body:[]};
   throw Error("Unexpected "+url.pathname);
 });
 assert.equal((await noResume.trakt.getResumeCheckpoint(current)).progress,null);
 const failed=setup((method,url)=>{
   if(url.pathname==="/shows/4242/seasons/2/episodes/9")
     return {status:200,body:{title:"Test of Pride",season:2,number:9}};
   if(url.pathname==="/sync/playback/episodes")return {status:503,body:{error:"unavailable"}};
   throw Error("Unexpected "+url.pathname);
 });
 assert.equal((await failed.trakt.getResumeCheckpoint(current)).status,"unavailable");
 const invalid=setup((method,url)=>{
   if(url.pathname==="/shows/4242/seasons/2/episodes/9")
     return {status:200,body:{title:"Test of Pride",season:2,number:9}};
   if(url.pathname==="/sync/playback/episodes")return {status:200,body:[
    {...checkpoints[0],progress:"corrupted"}
   ]};
   throw Error("Unexpected "+url.pathname);
 });
 assert.equal((await invalid.trakt.getResumeCheckpoint(current)).status,"unavailable");
 console.log("remote read-only Trakt resume preflight / exact S/E tests PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});