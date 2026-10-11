// MediaFusion's /streaming_provider/{secret}/playback/{provider}/{info_hash}/{season}/{episode}
// explicitly encodes season & episode. The stream title may be a localized *episode*
// title, never a trustworthy movie or show identity on its own.
var CACHE_PATH="@data/mediafusion-manual-show-cache.json", TTL_MS=60*24*60*60*1000, MAX=64;
function finger(value){
  var a=2166136261>>>0,b=330721643>>>0, text=String(value);
  for(var i=0;i<text.length;i++){
    var c=text.charCodeAt(i);
    a=Math.imul(a^c,16777619)>>>0;
    b=Math.imul(b^c,2246822519)>>>0;
  }
  return a.toString(16).padStart(8,"0")+b.toString(16).padStart(8,"0");
}
function fromUrl(value){
  var input=String(value||"");
  var match=input.match(/^https?:\/\/([^/?#:]+)(?::\d+)?\/streaming_provider\/[^/?#]+\/playback\/([a-z][a-z0-9_-]{1,30})\/([a-f0-9]{40}|[a-f0-9]{64})\/(\d{1,3})\/(\d{1,4})(?=\/|[?#]|$)/i);
  if(!match)return null;
  var host=match[1].toLowerCase();
  if(!/^(?:mediafusion(?:-dev)?\.elfhosted\.com|mediafusionfortheweebs\.midnightignite\.me)$/.test(host))return null;
  var season=Number(match[4]),episode=Number(match[5]);
  if(!Number.isInteger(season)||season<0||season>100||!Number.isInteger(episode)||episode<1||episode>9999)return null;
  return {kind:"episode",season:season,episode:episode,provider:match[2].toLowerCase(),
    fingerprint:finger([host,match[2].toLowerCase(),match[3].toLowerCase()].join("|"))};
}
function fromSource(source){
  var s=source||{};
  return fromUrl(s.path)||fromUrl(s.url)||null;
}
function create(file,options){
  var now=options&&options.now||Date.now;
  function read(){
    try {
      var raw=file.exists(CACHE_PATH)?JSON.parse(file.read(CACHE_PATH)):[];
      if(!Array.isArray(raw))return [];
      return raw.filter(function(x){
        return x && /^[a-f0-9]{16}$/.test(x.fingerprint||"") &&
          Number.isInteger(x.season)&&x.season>=0&&x.season<=100&&
          Number.isInteger(x.trakt)&&x.trakt>0&&
          typeof x.title==="string"&&x.title.length>0&&x.title.length<240&&
          Number.isFinite(x.createdAt)&&now()-x.createdAt>=0&&now()-x.createdAt<TTL_MS;
      }).slice(0,MAX);
    }catch(_e){return [];}
  }
  function find(hint){
    if(!hint || !hint.fingerprint)return null;
    return read().find(x=>x.fingerprint===hint.fingerprint&&x.season===hint.season)||null;
  }
  function remember(hint,trakt,title){
    if(!hint || !hint.fingerprint || !Number.isInteger(Number(trakt)) ||
       Number(trakt)<=0 || !String(title||"").trim())return false;
    var rec={fingerprint:hint.fingerprint,season:hint.season,
      trakt:Number(trakt),title:String(title).trim().slice(0,230),createdAt:now()};
    var entries=read().filter(x=>!(x.fingerprint===rec.fingerprint&&x.season===rec.season));
    entries.unshift(rec);
    try{file.write(CACHE_PATH,JSON.stringify(entries.slice(0,MAX)));return true;}catch(_e){return false;}
  }
  return {find:find,remember:remember};
}
module.exports={fromUrl:fromUrl,fromSource:fromSource,create:create};