const assert = require("node:assert/strict");
const path = require("node:path");
const TOKEN_PATH = "@data/trakt-token.json";
const CACHE_PATH = "@data/trakt-cache.json";

function setup(initial, handler) {
  const mod = path.resolve(__dirname, "../trakt.js");
  delete require.cache[mod];
  const trakt = require("../trakt.js");
  const store = Object.assign({
    [TOKEN_PATH]: JSON.stringify({access_token:"token",refresh_token:"refresh",
      created_at:Math.floor(Date.now()/1000),expires_in:3600})
  },initial||{});
  let paths=[];
  trakt.configure({
    file: {exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>{store[k]=v;}},
    preferences: {get(){return undefined;}},
    apiGate:{request:(_method,send)=>send(),status:()=>({mode:"online"})},
    logger(){},notify(){},
    utils: {
      keyChainRead(){return "";},
      keyChainWrite(){return true;},
      async exec(_exe,args){
        const url=new URL(args[args.length-1]);
        paths.push(url.pathname);
        const response=handler(url);
        return {status:0,stderr:"",stdout:JSON.stringify(response.body)+
          "\n__IINA_TRAKT_STATUS__:"+response.statusCode};
      }
    }
  });
  return {trakt,store,paths};
}

(async function(){
  const wrong=setup({},url=>{
    if(url.pathname==="/search/movie") return {statusCode:200,body:[
      {score:20,movie:{title:"Gegen den Strom - Abgetaucht in Venezuela",
        ids:{trakt:4001}}}
    ]};
    throw Error("Unexpected "+url.pathname);
  });
  const media={type:"movie",title:"Strom ozvěny"};
  assert.equal(await wrong.trakt.getTraktIds(media),null,
    "False-positive high Trakt search score must not override title mismatch");
  assert.ok(!JSON.stringify(wrong.store).includes("4001"),
    "wrong Trakt ID must not be cached");

  const legacy=setup({[CACHE_PATH]:JSON.stringify({
    movie:{"strom ozvěny|":4001},show:{}
  })},url=>{
    if(url.pathname==="/movies/4001") return {statusCode:200,body:{
      title:"Gegen den Strom - Abgetaucht in Venezuela",ids:{trakt:4001}
    }};
    if(url.pathname==="/search/movie") return {statusCode:200,body:[]};
    throw Error("Unexpected "+url.pathname);
  });
  assert.equal(await legacy.trakt.getTraktIds(media),null,
    "Previously wrong cached ID must not continue scrobbling");
  const cache=JSON.parse(legacy.store[CACHE_PATH]);
  assert.equal(cache.movie["strom ozvěny|"],-1);

  const same=setup({},url=>{
    if(url.pathname==="/search/movie") return {statusCode:200,body:[
      {score:9,movie:{title:"Strom ozveny",ids:{trakt:123}}}
    ]};
    throw Error("Unexpected "+url.pathname);
  });
  assert.deepEqual(await same.trakt.getTraktIds(media),{trakt:123},
    "Valid same-title match with diacritics folded remains automatic");

  const manual=setup({},url=>{
    if(url.pathname==="/search/movie") return {statusCode:200,body:[]};
    throw Error("Unexpected "+url.pathname);
  });
  await manual.trakt.applyMatchOverride(media,900);
  assert.deepEqual(await manual.trakt.getTraktIds(media),{trakt:900},
    "Explicit manual override should continue to work");
  assert.deepEqual(JSON.parse(manual.store[CACHE_PATH]).movie["strom ozvěny|"],
    {trakt:900,manual:true});


  const noShow=setup({},url=>{throw Error("No lookup should occur: "+url.pathname);});
  const unresolvedEpisode={type:"episode",title:"Unknown Series",
    showTitle:"Unknown Series",season:2,episode:8,episodeTitle:"Strom ozvěny",
    unresolvedShow:true};
  assert.equal(await noShow.trakt.getTraktIds(unresolvedEpisode),null,
    "Season/episode alone must not identify a show");
  assert.equal(noShow.paths.length,0,"unresolved episode must not hit Trakt");

  const learned=setup({},url=>{
    if(url.pathname==="/shows/4242/seasons/2/episodes/8")return {
      statusCode:200,body:{title:"The Echo Tree",season:2,number:8}
    };
    throw Error("Unexpected API "+url.pathname);
  });
  const trusted={...unresolvedEpisode,title:"The Legend of Vox Machina",
    showTitle:"The Legend of Vox Machina",unresolvedShow:false,manualTraktId:4242};
  assert.deepEqual(await learned.trakt.getTraktIds(trusted),{trakt:4242});
  assert.deepEqual(await learned.trakt.getTraktIds(trusted),{trakt:4242});
  assert.equal(learned.paths.length,1,"verified pack episode should be cached");

  console.log("false-positive matching guard tests passed");
})().catch(err=>{console.error(err);process.exitCode=1;});
