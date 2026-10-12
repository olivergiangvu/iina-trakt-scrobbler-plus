const assert = require("node:assert/strict");
const path = require("node:path");
const TOKEN = "@data/trakt-token.json";
const CACHE = "@data/trakt-cache.json";

function setup(searchItems) {
  const mod = path.resolve(__dirname, "../trakt.js");
  delete require.cache[mod];
  const trakt = require("../trakt.js");
  const store = {[TOKEN]:JSON.stringify({
    access_token:"test-only",refresh_token:"refresh",
    created_at:Math.floor(Date.now()/1000),expires_in:3600
  })};
  const calls = [];
  trakt.configure({
    file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>{store[k]=v;}},
    preferences:{get(){return undefined;}},
    apiGate:{request:(_method,send)=>send(),status:()=>({mode:"online"})},
    logger(){}, notify(){},
    utils:{
      keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args){
        const url=new URL(args[args.length-1]);calls.push(url.pathname);
        let body;
        if(url.pathname==="/search/show")body=searchItems;
        else if(url.pathname==="/shows/222/seasons/1/episodes/10")
          body={title:"A Second Chance At Love",season:1,number:10};
        else if(url.pathname==="/shows/222/seasons/1/episodes/9")
          body={title:"Other episode",season:1,number:9};
        else throw Error("Unexpected API request "+url.pathname);
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:200"};
      }
    }
  });
  return {trakt,calls,store};
}
const matched={score:10,show:{title:"OK! Let's Get Divorced",
  year:2026,ids:{trakt:222}}};
const anime={score:19,show:{title:"A Certain Magical Index",
  year:2008,ids:{trakt:111}}};
const info={type:"episode",title:"OK! Let's Get Divorced",
  showTitle:"OK! Let's Get Divorced",season:1,episode:10,
  episodeTitle:"A Second Chance At Love",identitySource:"aiostreams-title-fragment"};
(async()=>{
  const wrong=setup([anime]);
  assert.equal(await wrong.trakt.getTraktIds(info),null,
    "never auto-scrobble the wrong Index series from an HLS filename");
  assert.deepEqual(wrong.calls,["/search/show"],
    "wrong candidate must be rejected before episode lookup");
  const correct=setup([anime,matched]);
  assert.deepEqual(await correct.trakt.getTraktIds(info),{trakt:222},
    "one exact-title show and existing S01E10 may scrobble");
  assert.ok(correct.calls.includes("/shows/222/seasons/1/episodes/10"));
  const before=correct.calls.length;
  assert.deepEqual(await correct.trakt.getTraktIds(info),{trakt:222});
  assert.equal(correct.calls.length,before,"verified episode lookup should be cached");
  assert.ok(Object.values(JSON.parse(correct.store[CACHE]).show).some(
    x=>x.aiosExact&&x.titleKey==="ok lets get divorced"&&x.trakt===222));
  const other={...info,episode:9};
  assert.deepEqual(await correct.trakt.getTraktIds(other),{trakt:222});
  assert.ok(correct.calls.includes("/shows/222/seasons/1/episodes/9"),
    "each individual S/E requires verification, not just a cached show");
  const duplicate=setup([matched,{...matched,show:{
    ...matched.show,ids:{trakt:333}}}]);
  assert.equal(await duplicate.trakt.getTraktIds(info),null,
    "multiple same-title series without explicit IDs are ambiguous");
  assert.deepEqual(duplicate.calls,["/search/show"]);
  console.log("AIOStreams strict exact-title/unique series/S-E Trakt resolver PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
