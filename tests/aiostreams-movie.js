const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const fragment=require("../aiostreams-fragment.js");
const identity=require("../playback-identity.js");
const parser=require("../parser.js");
const stream=require("../stream-source.js");
parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});

const title="Poetic Justice";
const u="https://example.invalid/private/play/movie/opaque/Poetic.Justice.1993.mkv#aios_title="+
  encodeURIComponent(title);
const source={url:u,path:u,filename:"Poetic.Justice.1993.mkv#aios_title="+title,
  title:"Poetic.Justice.1993.mkv#aios_title="+title,
  mediaTitle:"Poetic.Justice.1993.mkv#aios_title="+title};
const meta=fragment.inspect(source);
assert.equal(meta.present,true);
assert.equal(meta.valid,true);
assert.equal(meta.parsed.kind,"movie");
assert.equal(meta.parsed.title,title);
assert.equal(meta.parsed.year,1993);
const picked=identity.identify(source,parser,stream);
assert.equal(picked.source,"aiostreams-title-fragment");
assert.equal(picked.parsed.title,title);
assert.equal(picked.parsed.year,1993);
assert.equal(picked.parsed.parserSource,"aiostreams-title-fragment");
assert.equal(fragment.inspect({...source,filename:"Another.Movie.1993.mkv"}).parsed.year,null,
  "year must be independently tied to exact title");
assert.equal(fragment.inspect({...source,filename:"Poetic.Justice.1994.mkv"}).parsed.year,1994,
  "filename year is explicit and cannot be secretly changed to 1993");
assert.equal(fragment.inspect({...source,
  url:u.replace("#aios_title=Poetic%20Justice","#aios_title=Poetic%20Justice%20(1993)"),
  path:u.replace("#aios_title=Poetic%20Justice","#aios_title=Poetic%20Justice%20(1993)")}).parsed.year,1993);

const noYear=identity.identify({
  url:"https://example.invalid/index.m3u8#aios_title=Poetic%20Justice",
  path:"https://example.invalid/index.m3u8#aios_title=Poetic%20Justice",
  filename:"index.m3u8#aios_title=Poetic Justice"
},parser,stream);
assert.equal(noYear.parsed.kind,"movie");
assert.equal(noYear.parsed.year,null,"do not invent a production year");
const invalid=fragment.inspect({...source,
  url:u.replace("Poetic%20Justice","Poetic%20Justice%20(1992)"),
  path:u.replace("Poetic%20Justice","Poetic%20Justice%20(1992)")});
assert.equal(invalid.valid,false,"declared year and proven filename year conflict");

const TOKEN="@data/trakt-token.json";
const CACHE="@data/trakt-cache.json";
function setup(results, fetched) {
  const mod=path.resolve(__dirname,"../trakt.js");
  delete require.cache[mod];
  const trakt=require("../trakt.js");
  const stored={[TOKEN]:JSON.stringify({access_token:"unit",
    refresh_token:"refresh",created_at:Math.floor(Date.now()/1000),expires_in:3600})};
  const paths=[];
  trakt.configure({
    file:{exists:p=>Object.hasOwn(stored,p),read:p=>stored[p],write:(p,v)=>{stored[p]=v;}},
    preferences:{get(){return undefined;}},
    apiGate:{request:(_m,send)=>send(),status:()=>({mode:"online"})},
    logger(){},notify(){},
    utils:{
      keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args) {
        const u=new URL(args[args.length-1]);
        paths.push(u.pathname);
        let body,code=200;
        if(u.pathname==="/search/movie")body=results;
        else if(u.pathname==="/movies/777")body=fetched||{title:"Poetic Justice",year:1993,ids:{trakt:777}};
        else throw Error("Unexpected URL "+u.pathname);
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:"+code};
      }
    }
  });
  return {trakt,stored,paths};
}
const right={score:14,movie:{title:"Poetic Justice",year:1993,ids:{trakt:777}}};
const falseHit={score:20,movie:{title:"Justice",year:1993,ids:{trakt:555}}};
const wrongYear={score:18,movie:{title:"Poetic Justice",year:1994,ids:{trakt:888}}};
const info={type:"movie",title:"Poetic Justice",year:1993,
  identitySource:"aiostreams-title-fragment"};
(async()=>{
  const c=setup([falseHit,right,wrongYear]);
  assert.deepEqual(await c.trakt.getTraktIds(info),{trakt:777},
    "verified exact film title + production year is a safe match");
  assert.deepEqual(c.paths,["/search/movie","/movies/777"]);
  const before=c.paths.length;
  assert.deepEqual(await c.trakt.getTraktIds(info),{trakt:777});
  assert.equal(c.paths.length,before,"verified result can be cached");
  assert.ok(Object.values(JSON.parse(c.stored[CACHE]).movie).some(x=>
    x.aiosMovieExact&&x.titleKey==="poetic justice"&&x.year===1993));
  const noYearClient=setup([right]);
  assert.equal(await noYearClient.trakt.getTraktIds({...info,year:null}),null);
  assert.deepEqual(noYearClient.paths,[],"never title-only scrobble a yearless HLS movie");
  const duplicate=setup([right,{...right,movie:{...right.movie,ids:{trakt:999}}}]);
  assert.equal(await duplicate.trakt.getTraktIds(info),null,
    "same title+year requires manual if multiple Trakt IDs");
  assert.deepEqual(duplicate.paths,["/search/movie"]);
  const wrong=setup([falseHit,wrongYear]);
  assert.equal(await wrong.trakt.getTraktIds(info),null,
    "top search score is not identity proof");
  const badDetail=setup([right],{title:"Poetic Justice",year:1994,ids:{trakt:777}});
  assert.equal(await badDetail.trakt.getTraktIds(info),null,
    "canonical detail year must still match");
  const ui=fs.readFileSync(path.join(__dirname,"../sidebar.html"),"utf8");
  assert.doesNotMatch(ui,/!state\.playback\.available\) \{\s*setText\("diagnostics-feedback"/,
    "Copy Diagnostics must remain available when matching fails");
  const main=fs.readFileSync(path.join(__dirname,"../main.js"),"utf8");
  assert.match(main,/identitySource: parsed\.parserSource === "aiostreams-title-fragment"/);
  console.log("Poetic Justice movie title/year fragment, Trakt exact movie and no-active diagnostics PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});
