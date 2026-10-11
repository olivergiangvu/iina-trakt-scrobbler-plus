// Structured external IDs from user-opened playback links.
// Never infer identity from opaque tokens, torrent hashes, or localized titles.
// Only allow explicit query fields and known Stremio media-id paths.
function validImdb(value) {
  var s=String(value||"").trim();
  return /^tt\d{6,10}$/i.test(s)?s.toLowerCase():"";
}
function validTmdb(value) {
  var s=String(value||"").trim();
  return /^[1-9]\d{0,8}$/.test(s)?Number(s):0;
}
function position(value,min,max) {
  var s=String(value===null||value===undefined?"":value);
  if(!/^\d{1,4}$/.test(s))return null;
  var n=Number(s);return n>=min&&n<=max?n:null;
}
function queryEntries(url) {
  var q=String(url||"").split("#")[0].split("?")[1]||"";
  return q.split("&").slice(0,80).reduce(function(list,part){
    if(!part)return list;
    var i=part.indexOf("="),k=i<0?part:part.slice(0,i),v=i<0?"":part.slice(i+1);
    try{k=decodeURIComponent(k.replace(/\+/g," ")).toLowerCase();}catch(_e){return list;}
    try{v=decodeURIComponent(v.replace(/\+/g," "));}catch(_e){return list;}
    list.push([k,v.trim()]);return list;
  },[]);
}
function parseOne(value) {
  var url=String(value||"");
  if(!/^https?:\/\//i.test(url))return null;
  var entries=queryEntries(url);
  function values(keys) {return entries.filter(function(x){return keys.indexOf(x[0])!==-1;}).map(function(x){return x[1];});}
  var imdbs=[],tmdbs=[],types=[],seasons=[],episodes=[];
  values(["media_id","imdb","imdb_id","imdbid"]).forEach(function(v) {
    var id=validImdb(v);if(id)imdbs.push(id);
    var m=/^imdb:(tt\d{6,10})$/i.exec(v);if(m)imdbs.push(m[1].toLowerCase());
    var t=/^tmdb:(\d{1,9})$/i.exec(v);if(t)tmdbs.push(Number(t[1]));
  });
  values(["tmdb_id","tmdbid","tmdb"]).forEach(function(v){var t=validTmdb(v);if(t)tmdbs.push(t);});
  values(["media_type","type","stremio_type"]).forEach(function(v) {
    if(/^(?:series|show|tv|episode)$/i.test(v))types.push("episode");
    if(/^movie$/i.test(v))types.push("movie");
  });
  values(["season","season_number"]).forEach(function(v){var x=position(v,0,100);if(x!==null)seasons.push(x);});
  values(["episode","episode_number"]).forEach(function(v){var x=position(v,1,9999);if(x!==null)episodes.push(x);});

  var stremio=/\/(?:stream|meta)\/(series|movie)\/((?:tt\d{6,10})(?::\d{1,3}:\d{1,4})?)(?:\.json)?(?:[/?#]|$)/i.exec(url);
  if(stremio) {
    types.push(stremio[1]==="series"?"episode":"movie");
    var ids=stremio[2].split(":");
    var id=validImdb(ids[0]);if(id)imdbs.push(id);
    if(ids.length===3) {
      var s=position(ids[1],0,100),e=position(ids[2],1,9999);
      if(s!==null&&e!==null){seasons.push(s);episodes.push(e);}
    }
  }
  function unique(xs) {return xs.filter(function(v,i){return xs.indexOf(v)===i;});}
  imdbs=unique(imdbs);tmdbs=unique(tmdbs);types=unique(types);
  seasons=unique(seasons);episodes=unique(episodes);
  return {
    imdb:imdbs[0]||"",tmdb:tmdbs[0]||0,
    kind:types[0]||"",
    season:seasons.length===1?seasons[0]:null,
    episode:episodes.length===1?episodes[0]:null,
    hasId:!!(imdbs.length||tmdbs.length),
    conflict:imdbs.length>1||tmdbs.length>1||types.length>1||
      seasons.length>1||episodes.length>1
  };
}
function inspect(source, route) {
  var data=source||{},a=[data.path,data.url].filter(function(x){return /^https?:\/\//i.test(String(x||""));});
  var parts=a.map(parseOne).filter(Boolean);
  if(!parts.length)return null;
  var imdbs=[],tmdbs=[],types=[],seasons=[],episodes=[];
  parts.forEach(function(x){
    if(x.imdb)imdbs.push(x.imdb);
    if(x.tmdb)tmdbs.push(x.tmdb);
    if(x.kind)types.push(x.kind);
    if(x.season!==null)seasons.push(x.season);
    if(x.episode!==null)episodes.push(x.episode);
  });
  if(route){
    types.push("episode");
    seasons.push(route.season);episodes.push(route.episode);
  }
  function uniq(xs){return xs.filter(function(v,i){return xs.indexOf(v)===i;});}
  imdbs=uniq(imdbs);tmdbs=uniq(tmdbs);types=uniq(types);
  seasons=uniq(seasons);episodes=uniq(episodes);
  var conflict=parts.some(function(x){return x.conflict;})||
    imdbs.length>1||tmdbs.length>1||types.length>1||
    seasons.length>1||episodes.length>1;
  if(conflict)return {conflict:true,kind:"",imdb:"",tmdb:0,season:null,episode:null};
  if(!imdbs.length&&!tmdbs.length)return null;
  return {
    conflict:false,imdb:imdbs[0]||"",tmdb:tmdbs[0]||0,
    kind:types[0]||"",
    season:seasons.length?seasons[0]:null,
    episode:episodes.length?episodes[0]:null,
    source:"explicit-playback-id"
  };
}
// A provider may supply an explicit series IMDb ID without S/E (e.g. Comet).
// Fill only the missing episode position using a confidently parsed filename.
// This is NOT proof of show identity: Trakt must still resolve the external ID,
// match the parsed show title, and verify that the episode exists.
function completeEpisodePosition(external, parsed) {
  if(!external||external.conflict||external.kind!=="episode")return external;
  if(!parsed||parsed.kind!=="episode"||parsed.unresolvedShow||
      !Number.isInteger(parsed.season)||parsed.season<0||parsed.season>100||
      !Number.isInteger(parsed.episode)||parsed.episode<1||parsed.episode>9999||
      !String(parsed.showTitle||"").trim()||
      /^unknown series$/i.test(String(parsed.showTitle||"").trim()))return external;
  if((external.season!==null&&external.season!==parsed.season)||
     (external.episode!==null&&external.episode!==parsed.episode))
    return Object.assign({},external,{conflict:true,reason:"episode-position-mismatch"});
  if(external.season!==null&&external.episode!==null)return external;
  return Object.assign({},external,{
    season:external.season===null?parsed.season:external.season,
    episode:external.episode===null?parsed.episode:external.episode,
    positionSource:"parsed-episode",
    expectedShowTitle:String(parsed.showTitle).trim()
  });
}
module.exports={inspect:inspect,parseOne:parseOne,
  completeEpisodePosition:completeEpisodePosition};