const assert = require("node:assert/strict");
const path = require("node:path");
const fragment = require("../aiostreams-fragment.js");
const identity = require("../playback-identity.js");
const parser = require("../parser.js");
const stream = require("../stream-source.js");
const TOKEN = "@data/trakt-token.json";
const CACHE = "@data/trakt-cache.json";

parser.configure({loadGuessitModule:()=>require("../vendor/guessit-js.compat.js")});
const title="The Diplomat (US) · S01E06 · Some Lusty Tornado";
const url="https://example.test/play/opaque#aios_title="+encodeURIComponent(title);
const source={path:url,url,
  filename:"The.Diplomat.2023.S01E06.mkv#aios_title="+title,
  mediaTitle:"The.Diplomat.2023.S01E06.mkv#aios_title="+title};
const extracted=fragment.inspect(source);
assert.equal(extracted.valid,true);
assert.equal(extracted.parsed.year,2023,"year comes from matching local basename only");
const media=identity.identify(source,parser,stream).parsed;
assert.equal(media.kind,"episode");
assert.equal(media.showTitle,"The Diplomat (US)");
assert.equal(media.year,2023);
assert.equal(media.season,1);
assert.equal(media.episode,6);
assert.equal(media.episodeTitle,"Some Lusty Tornado");
const wrongFile=fragment.inspect({...source,
  filename:"Another.Series.2022.S01E06.mkv#aios_title="+title});
assert.equal(wrongFile.parsed.year,null,"wrong-show filename is not year proof");
const wrongEpisode=fragment.inspect({...source,
  filename:"The.Diplomat.2023.S01E05.mkv#aios_title="+title});
assert.equal(wrongEpisode.parsed.year,null,"wrong episode filename is not year proof");

const netflix={score:12,show:{title:"The Diplomat",year:2023,ids:{trakt:196192}}};
const british={score:11,show:{title:"The Diplomat",year:2023,ids:{trakt:294000}}};
const anime={score:30,show:{title:"A Certain Magical Index",year:2008,ids:{trakt:1}}};
function makeClient(sets, episodes) {
  const mod=path.resolve(__dirname,"../trakt.js");
  delete require.cache[mod];
  const trakt=require("../trakt.js");
  const store = {[TOKEN]:JSON.stringify({
    access_token:"test-token",refresh_token:"refresh",
    created_at:Math.floor(Date.now()/1000),expires_in:3600})};
  const paths=[], queries=[];
  trakt.configure({
    file:{exists:k=>Object.hasOwn(store,k),read:k=>store[k],write:(k,v)=>{store[k]=v;}},
    preferences:{get(){return undefined;}},
    apiGate:{request:(_m,send)=>send(),status:()=>({mode:"online"})},
    logger(){}, notify(){},
    utils:{
      keyChainRead(){return "";},keyChainWrite(){return true;},
      async exec(_exe,args) {
        const request=new URL(args[args.length-1]);paths.push(request.pathname);
        let body, statusCode=200;
        if(request.pathname==="/search/show") {
          const query=request.searchParams.get("query");
          queries.push(query);
          body=sets[query]||[];
        } else {
          const m=/^\/shows\/(\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(request.pathname);
          if(!m)throw Error("Unexpected request "+request.pathname);
          const episode=episodes[Number(m[1])];
          if(!episode) {statusCode=404;body={error:"not_found"};}
          else body={title:episode,season:Number(m[2]),number:Number(m[3])};
        }
        return {status:0,stderr:"",stdout:JSON.stringify(body)+
          "\n__IINA_TRAKT_STATUS__:"+statusCode};
      }
    }
  });
  return {trakt,paths,queries,store};
}
const info={type:"episode",title:media.showTitle,showTitle:media.showTitle,
  year:media.year,season:1,episode:6,episodeTitle:media.episodeTitle,
  identitySource:"aiostreams-title-fragment"};
const noAliasSearch={"The Diplomat (US)":[anime]};
(async()=>{
  const good=makeClient({...noAliasSearch,
    "The Diplomat":[netflix,british,anime]},
    {196192:"Some Lusty Tornado",294000:"The Wrong Story"});
  assert.deepEqual(await good.trakt.getTraktIds(info),{trakt:196192},
    "only one candidate with matching canonical base + exact episode title");
  assert.deepEqual(good.queries,["The Diplomat (US)","The Diplomat"]);
  assert.ok(good.paths.includes("/shows/196192/seasons/1/episodes/6"));
  assert.ok(good.paths.includes("/shows/294000/seasons/1/episodes/6"));
  const requests=good.paths.length;
  assert.deepEqual(await good.trakt.getTraktIds(info),{trakt:196192});
  assert.equal(good.paths.length,requests,"verified alias cached per episode");
  const cache=JSON.parse(good.store[CACHE]);
  assert.ok(Object.values(cache.show).some(x=>x.aliasVerified&&x.episodeKey==="some lusty tornado"&&x.year===2023));
  const changedEpisode={...info,episodeTitle:"Some Other Title"};
  assert.equal(await good.trakt.getTraktIds(changedEpisode),null,
    "same S/E with different episode title must not inherit stale alias");
  const ambiguous=makeClient({...noAliasSearch,
    "The Diplomat":[netflix,british]},
    {196192:"Some Lusty Tornado",294000:"Some Lusty Tornado"});
  assert.equal(await ambiguous.trakt.getTraktIds(info),null,
    "two same-titled shows with identical episode titles require Manual Match");
  const yearConflict=makeClient({...noAliasSearch,
    "The Diplomat":[{...netflix,show:{...netflix.show,year:2024}}]},
    {196192:"Some Lusty Tornado"});
  assert.equal(await yearConflict.trakt.getTraktIds(info),null,
    "Trakt year mismatch cannot be ignored");
  assert.equal(yearConflict.paths.some(x=>x.includes("/episodes/6")),false);
  const falsePositive=makeClient({...noAliasSearch,"The Diplomat":[anime]},
    {1:"Some Lusty Tornado"});
  assert.equal(await falsePositive.trakt.getTraktIds(info),null,
    "unrelated anime must fail even with matching episode title");
  const wrongTitle=makeClient({...noAliasSearch,"The Diplomat":[netflix]},
    {196192:"The Wrong Episode"});
  assert.equal(await wrongTitle.trakt.getTraktIds(info),null,
    "alias and valid S/E alone are insufficient proof");
  const missingTitle=makeClient({...noAliasSearch,"The Diplomat":[netflix]},
    {196192:"Some Lusty Tornado"});
  assert.equal(await missingTitle.trakt.getTraktIds({...info,episodeTitle:""}),null,
    "cannot alias-match without exact episode title");
  const noTag=makeClient({"The Diplomat Cast":[netflix]}, {196192:"Some Lusty Tornado"});
  assert.equal(await noTag.trakt.getTraktIds({...info,showTitle:"The Diplomat Cast"}),null,
    "do not fuzzy match arbitrary similar names");
  console.log("AIOStreams country alias + filename year + Trakt exact episode checks PASS");
})().catch(err=>{console.error(err);process.exitCode=1;});
