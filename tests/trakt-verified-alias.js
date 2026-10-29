// Exact Trakt-catalog alias recognition must never be a fuzzy title guess.
const assert=require("node:assert/strict");
const path=require("node:path");
const TOKEN="@data/trakt-token.json", CACHE="@data/trakt-cache.json";
const official={title:"This City Never Sleeps",year:2026,
  ids:{trakt:401001,imdb:"tt39443161"}};
const media={type:"episode",title:"City of Elegance",showTitle:"City of Elegance",
  season:1,episode:2,episodeTitle:"Episode 2"};

function create(shows=[official], aliases={401001:[{title:"City of Elegance",country:"gb"}]}) {
  delete require.cache[path.resolve(__dirname,"../trakt.js")];
  const trakt=require("../trakt.js");
  const data={
    [TOKEN]:JSON.stringify({access_token:"mock",refresh_token:"mock",
      created_at:Math.floor(Date.now()/1000),expires_in:3600})
  };
  const calls=[];
  trakt.configure({
    file:{exists:p=>Object.hasOwn(data,p),read:p=>data[p],write:(p,v)=>{data[p]=String(v)}},
    logger(){},notify(){},preferences:{get(){return undefined;}},
    apiGate:{request:(_method,fn)=>fn(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args){
        const method=args[args.indexOf("-X")+1];
        const url=new URL(args[args.length-1]);
        calls.push(method+" "+url.pathname);
        assert.equal(method,"GET","Never scrobble when resolving an alias");
        let body;
        if(url.pathname==="/search/show"){
          body=shows.map((show,i)=>({score:10-i,show}));
        }else{
          const alias=/^\/shows\/(\d+)\/aliases$/.exec(url.pathname);
          const ep=/^\/shows\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(url.pathname);
          if(alias)body=aliases[Number(alias[1])]||[];
          else if(ep)body={title:"Episode "+ep[3],season:+ep[2],number:+ep[3]};
          else throw Error("Unexpected URL: "+url.pathname);
        }
        return {status:0,stderr:"",
          stdout:JSON.stringify(body)+"\n__IINA_TRAKT_STATUS__:200"};
      }
    }
  });
  return {trakt,data,calls};
}
(async function(){
  const confirmed=create();
  assert.deepEqual(await confirmed.trakt.getTraktIds(media),{trakt:401001},
    "Trakt's exact alias plus verified S/E can resolve a differently named show");
  const item=JSON.parse(confirmed.data[CACHE]).show["city of elegance|"];
  assert.equal(item.trakt,401001);
  assert.equal(item.identityVersion,2);
  assert.equal(item.source,"trakt-alias");
  assert.equal(item.imdb,"tt39443161");
  assert.deepEqual(await confirmed.trakt.getTraktIds({...media,episode:3}),{trakt:401001},
    "A unique Trakt-catalog alias is show-wide proof");

  const absent=create([official],{401001:[]});
  assert.equal(await absent.trakt.getTraktIds(media),null,
    "No alias in the Trakt catalog means NO inferred identity");

  const fuzzy=create([official],{401001:[{title:"City of Elegances"}]});
  assert.equal(await fuzzy.trakt.getTraktIds(media),null,
    "A close spelling must not bypass exact alias verification");

  const wrongYear=create([{...official,year:2023}]);
  assert.equal(await wrongYear.trakt.getTraktIds({...media,year:2026}),null,
    "Known conflicting production year must reject alias");
  assert.equal(wrongYear.calls.some(x=>x.endsWith("/aliases")),false);

  const competing={title:"A Different City",year:2026,ids:{trakt:401002}};
  const duplicate=create([official,competing],{
    401001:[{title:"City of Elegance"}],
    401002:[{title:"City of Elegance"}]
  });
  assert.equal(await duplicate.trakt.getTraktIds(media),null,
    "Duplicate exact aliases with generic episode titles must fail closed");

  const blocked=create([official],{401001:[{title:"City of Elegance, Part II"}]});
  assert.equal(await blocked.trakt.getTraktIds(media),null);
  console.log("Trakt exact aliases, unique match, no fuzzy, year check, duplicate fail-closed PASS");
})().catch(e=>{console.error(e);process.exitCode=1});
