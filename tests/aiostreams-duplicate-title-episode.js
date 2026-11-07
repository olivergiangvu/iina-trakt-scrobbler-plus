const assert=require("node:assert/strict");
const path=require("node:path");
const fragment=require("../aiostreams-fragment.js");
const identity=require("../playback-identity.js");
const parser=require("../parser.js");
const stream=require("../stream-source.js");
parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});
const title="The Diplomat · S02E04 · The Other Army";
const file="The Diplomat S02E04 The Other Army 2160p NF WEB-DL.mkv";
const source={url:"https://source.invalid/opaque#aios_title="+encodeURIComponent(title),
  path:"https://source.invalid/opaque#aios_title="+encodeURIComponent(title),
  filename:file+"#aios_title="+title,mediaTitle:"The Diplomat S02E04 The Other Army",
  metadataTitle:"The Diplomat S02E04 The Other Army"};
const parsed=identity.identify(source,parser,stream);
assert.equal(parsed.source,"aiostreams-title-fragment");
assert.equal(parsed.parsed.showTitle,"The Diplomat");
assert.equal(parsed.parsed.season,2);
assert.equal(parsed.parsed.episode,4);
assert.equal(parsed.parsed.episodeTitle,"The Other Army");
const media={type:"episode",title:parsed.parsed.showTitle,showTitle:parsed.parsed.showTitle,
  season:2,episode:4,episodeTitle:"The Other Army",
  identitySource:"aiostreams-title-fragment"};
const netflix={score:18,show:{title:"The Diplomat",year:2023,ids:{trakt:196192}}};
const british={score:17,show:{title:"The Diplomat",year:2023,ids:{trakt:294000}}};
const distractor={score:30,show:{title:"The Diplomat's Secret",year:2024,ids:{trakt:112233}}};
function client(episodes,results=[netflix,british,distractor],resume=[]){
  const id=path.resolve(__dirname,"../trakt.js");
  delete require.cache[id];
  const trakt=require("../trakt.js"),calls=[],store={
    "@data/trakt-token.json":JSON.stringify({access_token:"test",
      refresh_token:"test",created_at:Math.floor(Date.now()/1000),expires_in:3600})
  };
  trakt.configure({file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],
      write:(k,v)=>{store[k]=v;}},preferences:{get(){return undefined;}},
    logger(){},notify(){},apiGate:{request:(_method,fn)=>fn(),status:()=>({mode:"online"})},
    utils:{keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args) {
        const url=new URL(args[args.length-1]);
        const method=args[args.indexOf("-X")+1];calls.push(method+" "+url.pathname);
        let status=200,body={};
        if(url.pathname==="/search/show")body=results;
        else if(url.pathname==="/sync/playback/episodes")body=resume;
        else {
          const m=/^\/shows\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(url.pathname);
          if(!m)throw Error("Unexpected "+url.pathname);
          const title=episodes[Number(m[1])];
          if(!title){status=404;body={error:"not_found"};}
          else body={title,season:Number(m[2]),number:Number(m[3])};
        }
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:"+status};
      }
    }
  });
  return {trakt,calls,store};
}
(async()=>{
  const valid=client({196192:"The Other Army",294000:"The Last Dispatch"},undefined,[
    {progress:77.25,show:{ids:{trakt:196192}},episode:{season:2,number:4}},
    {progress:95,show:{ids:{trakt:294000}},episode:{season:2,number:4}},
    {progress:88,show:{ids:{trakt:196192}},episode:{season:2,number:3}}
  ]);
  assert.deepEqual(await valid.trakt.getTraktIds(media),{trakt:196192});
  assert.ok(valid.calls.includes("GET /shows/196192/seasons/2/episodes/4"));
  assert.ok(valid.calls.includes("GET /shows/294000/seasons/2/episodes/4"));
  let resume=await valid.trakt.getResumeCheckpoint(media);
  assert.deepEqual({status:resume.status,progress:resume.progress,traktId:resume.traktId},
    {status:"ok",progress:77.25,traktId:196192});
  assert.equal(valid.calls.some(x=>x.startsWith("POST")),false,"preflight read-only");
  const count=valid.calls.length;
  assert.deepEqual(await valid.trakt.getTraktIds(media),{trakt:196192});
  assert.equal(valid.calls.length,count,"verified duplicate resolution cached");

  const same=client({196192:"The Other Army",294000:"The Other Army"});
  assert.equal(await same.trakt.getTraktIds(media),null,
    "two same-name shows with the SAME S/E episode title fail closed");
  assert.equal((await same.trakt.getResumeCheckpoint(media)).reason,"unverified-id");
  const absent=client({196192:"Wrong Episode",294000:"Wrong Episode"});
  assert.equal(await absent.trakt.getTraktIds(media),null,
    "wrong S/E titles must not scrobble");
  const noTitle=client({196192:"The Other Army",294000:"The Last Dispatch"});
  assert.equal(await noTitle.trakt.getTraktIds({...media,episodeTitle:""}),null,
    "ambiguity without episode-title proof requires manual correction");
  const truncated=client({196192:"The Other Army",294000:"The Last Dispatch"},
    [netflix,british,...Array.from({length:18},(_,i)=>({
      score:9,show:{title:"Other Show "+i,year:2023,ids:{trakt:10000+i}}
    }))]);
  assert.equal(await truncated.trakt.getTraktIds(media),null,
    "truncated Trakt page cannot guarantee uniqueness");
  assert.equal(truncated.calls.some(x=>x.includes("/episodes/")),false);
  console.log("The Diplomat duplicated show name, unique exact episode, resume guard and ambiguity tests PASS");
})().catch(error=>{console.error(error);process.exitCode=1;});