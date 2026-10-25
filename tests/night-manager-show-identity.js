// Regression: The Night Manager (2016) must not resolve to its 2023 remake.
// No real Trakt requests or scrobble writes. All responses are mocked.
const assert = require("node:assert/strict");
const path = require("node:path");
const TOKEN = "@data/trakt-token.json";
const CACHE = "@data/trakt-cache.json";
const wrong = {title:"The Night Manager",year:2023,
  ids:{trakt:202191,imdb:"tt15576504"}};
const correct = {title:"The Night Manager",year:2016,
  ids:{trakt:94686,imdb:"tt1399664"}};
const third = {title:"The Night Manager",year:0,
  ids:{trakt:314181}};
const media = {type:"episode",title:"The Night Manager",
  showTitle:"The Night Manager",year:2016,season:1,episode:2,
  episodeTitle:"Episode 2"};

function setup(legacy, shows=[wrong,correct,third]) {
  const modulePath=path.resolve(__dirname,"../trakt.js");
  delete require.cache[modulePath];
  const trakt=require("../trakt.js");
  const store={
    [TOKEN]:JSON.stringify({access_token:"test-token",refresh_token:"unused",
      created_at:Math.floor(Date.now()/1000),expires_in:3600})
  };
  if(legacy)store[CACHE]=JSON.stringify({movie:{},show:{"the night manager|2016":legacy}});
  const calls=[];
  trakt.configure({
    file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],
      write:(k,v)=>{store[k]=String(v);}},
    preferences:{get(){return undefined;}},logger(){},notify(){},
    apiGate:{request:(_method,fn)=>fn(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args) {
        const url=new URL(args[args.length-1]);
        const method=args[args.indexOf("-X")+1];
        calls.push(method+" "+url.pathname);
        assert.equal(method,"GET","Identity lookup must never scrobble or write to Trakt");
        let statusCode=200,body={};
        if(url.pathname==="/search/show") {
          body=shows.map((show,i)=>({score:10-i,show}));
        } else {
          const ep=/^\/shows\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(url.pathname);
          if(ep) {
            const id=Number(ep[1]);
            body={title:id===202191?"Part I - Mission":"Episode 2",
              season:Number(ep[2]),number:Number(ep[3])};
          } else {
            const detail=/^\/shows\/(\d+)$/.exec(url.pathname);
            if(detail) {
              body=shows.find(s=>s.ids.trakt===Number(detail[1]))||{};
            } else throw Error("Unexpected "+url.pathname);
          }
        }
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:"+statusCode};
      }
    }
  });
  return {trakt,store,calls};
}

(async()=>{
  const first=setup();
  assert.deepEqual(await first.trakt.getTraktIds(media),{trakt:94686},
    "Auto matching must require 2016 rather than choosing the 2023 first hit");
  assert.equal(first.calls.includes("GET /shows/202191/seasons/1/episodes/2"),false,
    "Conflicting production year rejected BEFORE episode lookup");
  const fixed=JSON.parse(first.store[CACHE]).show["the night manager|2016"];
  assert.equal(fixed.trakt,94686);
  assert.equal(fixed.identityVersion,2);
  assert.equal(fixed.showYear,2016);
  assert.equal(fixed.imdb,"tt1399664");
  assert.equal(fixed.source,"title-year");
  const requestCount=first.calls.length;
  assert.deepEqual(await first.trakt.getTraktIds({...media,episode:3}),{trakt:94686});
  assert.equal(first.calls.length,requestCount,
    "Identity v2 cache may be reused without additional network calls");

  const cachedWrong=setup({trakt:202191,verified:true});
  assert.deepEqual(await cachedWrong.trakt.getTraktIds(media),{trakt:94686},
    "Legacy verified cache pointing at 2023 must be invalidated and rematched");
  assert.equal(JSON.parse(cachedWrong.store[CACHE]).show["the night manager|2016"].trakt,94686);

  const cachedRight=setup({trakt:94686,verified:true});
  assert.deepEqual(await cachedRight.trakt.getTraktIds(media),{trakt:94686},
    "Legacy but correct manual cache must migrate safely");

  const ambiguous=setup(null,[wrong,correct,{...correct,ids:{trakt:314181}}]);
  assert.equal(await ambiguous.trakt.getTraktIds(media),null,
    "Two 2016 same-title shows with indistinguishable episode titles must fail closed");
  assert.equal(ambiguous.calls.some(p=>p.startsWith("POST")),false);

  const noYear=setup();
  assert.equal(await noYear.trakt.getTraktIds({...media,year:null}),null,
    "No production year + generic Episode 2 must not select the first show");
  const manual=setup();
  const chosen=await manual.trakt.applyMatchOverride(media,94686);
  assert.deepEqual(chosen,{trakt:94686});
  assert.deepEqual(await manual.trakt.getTraktIds(media),{trakt:94686});
  assert.equal(JSON.parse(manual.store[CACHE]).show["the night manager|2016"].source,"manual");
  console.log("Night Manager strict identity, cache v2 migration, ambiguity and manual match PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
