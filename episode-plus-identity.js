"use strict";
/* Episode Info Plus: conservative structured playback identity.
   External IDs are provider hints, NOT proof that the filename title matches. */
function dec(s){try{return decodeURIComponent(String(s||"").replace(/\+/g," "));}catch(_){return "";}}
function num(s,lo,hi){if(!/^\d{1,4}$/.test(String(s)))return null;var n=+s;return n>=lo&&n<=hi?n:null;}
function inspectUrls(h){
 var urls=[h.path,h.url].filter(function(x,i,a){return /^https?:\/\//i.test(String(x||""))&&a.indexOf(x)===i;});
 var ids=[],tmdb=[],types=[],seasons=[],episodes=[];
 function addId(x){var m=/^(tt\d{6,10})(?::(\d{1,3}):(\d{1,4}))?$/i.exec(String(x||"").trim());
  if(m){ids.push(m[1].toLowerCase());if(m[2]!=null){seasons.push(+m[2]);episodes.push(+m[3]);types.push("episode");}}}
 urls.forEach(function(url){var bare=String(url).split("#")[0],q=bare.indexOf("?"),path=q<0?bare:bare.slice(0,q);
  (q<0?"":bare.slice(q+1)).split("&").slice(0,80).forEach(function(kv){if(!kv)return;var i=kv.indexOf("="),k=dec(i<0?kv:kv.slice(0,i)).toLowerCase(),v=dec(i<0?"":kv.slice(i+1));
   if(["media_id","imdb","imdb_id","imdbid"].indexOf(k)>=0)addId(v.replace(/^imdb:/i,""));
   if(["tmdb","tmdb_id","tmdbid"].indexOf(k)>=0&&/^[1-9]\d{0,8}$/.test(v))tmdb.push(+v);
   if(["media_type","type","stremio_type"].indexOf(k)>=0){if(/^(series|tv|show|episode)$/i.test(v))types.push("episode");if(/^movie$/i.test(v))types.push("movie");}
   if(["season","season_number"].indexOf(k)>=0){var s=num(v,0,100);if(s!==null)seasons.push(s);}
   if(["episode","episode_number"].indexOf(k)>=0){var e=num(v,1,9999);if(e!==null)episodes.push(e);}
  });
  var st=/\/(?:stream|meta)\/(series|movie)\/(tt\d{6,10}(?::\d{1,3}:\d{1,4})?)(?:\.json)?(?:\/|$)/i.exec(path);
  if(st){types.push(st[1].toLowerCase()==="movie"?"movie":"episode");addId(st[2]);}
  // MediaFusion explicitly carries episode coordinates but not a show identity.
  // Accept this positional hint only on known provider hosts.
  var mf=/^https?:\/\/(?:mediafusion(?:-dev)?\.elfhosted\.com|mediafusionfortheweebs\.midnightignite\.me)\/streaming_provider\/[^/?#]+\/playback\/[a-z][a-z0-9_-]{1,30}\/[a-f0-9]{40}(?:[a-f0-9]{24})?\/(\d{1,3})\/(\d{1,4})(?:\/|$)/i.exec(path);
  if(mf){var ms=num(mf[1],0,100),me=num(mf[2],1,9999);
    if(ms!==null&&me!==null){seasons.push(ms);episodes.push(me);types.push("episode");}}
  var seg=path.split("/"),at=seg.indexOf("playback"),tail=at<0?[]:seg.slice(at+1);
  if(/^[0-9a-f]{40}$/i.test(tail[0]||"")&&tail.length>=5){var s=num(tail[3],0,100),e=num(tail[4],1,9999);if(s!==null&&e!==null){seasons.push(s);episodes.push(e);types.push("episode");}}
 });
 function uniq(a){return a.filter(function(x,i){return a.indexOf(x)===i;});}
 ids=uniq(ids);tmdb=uniq(tmdb);types=uniq(types);seasons=uniq(seasons);episodes=uniq(episodes);
 return {imdb:ids[0]||"",tmdb:tmdb[0]||0,type:types[0]||"",season:seasons.length===1?seasons[0]:null,
  episode:episodes.length===1?episodes[0]:null,conflict:ids.length>1||tmdb.length>1||types.length>1||seasons.length>1||episodes.length>1};
}
function identify(h,readings,normalize){
 var id=inspectUrls(h||{});if(id.conflict||(!id.imdb&&!id.tmdb))return null;
 var rs=(readings||[]).filter(function(r){return r&&r.p;});
 if(rs.some(function(r){return !!r.p.extra;}))return null;
 var choices=rs.filter(function(r){var p=r.p;return !!p.title&&!p.extra&&!p.dated&&!p.lead&&!p.seasonWords&&
   ((p.season!=null&&p.episode!=null)||(p.episode==null&&p.year!=null&&!r.weak));});
 if(!choices.length)return null;
 var p=choices[0].p,movie=p.episode==null,norm=normalize||function(x){return String(x||"").toLowerCase();};
 if((movie&&id.type==="episode")||(!movie&&id.type==="movie"))return null;
 if(!movie&&(p.season<0||p.season>100||p.episode<1||p.episode>9999))return null;
 if(id.season!=null&&(movie||id.season!==p.season))return null;
 if(id.episode!=null&&(movie||id.episode!==p.episode))return null;
 if(choices.some(function(r){var x=r.p;return (x.episode==null)!==movie||norm(x.title)!==norm(p.title)||
  (!movie&&((x.season!=null&&x.season!==p.season)||(x.episode!=null&&x.episode!==p.episode)));}))return null;
 var info={isMovie:movie,isStream:true,showTitle:movie?"Movie":p.title,
   epTitle:movie?p.title:(p.episodeTitle||"Episode "+p.episode),
   code:movie?String(p.year||""):"S"+String(p.season).padStart(2,"0")+"E"+String(p.episode).padStart(2,"0"),
   airDate:"",rating:"",overview:"Metadata pending (TMDB unavailable)",posterUrl:"",
   tmdbId:id.tmdb?String(id.tmdb):"",season:movie?null:p.season,episode:movie?null:p.episode,
   identitySource:id.imdb?"IMDb + filename":"TMDB ID + filename",metadataPending:true};
 if(id.imdb){if(movie)info.imdbId=id.imdb;else info.parentImdbId=id.imdb;}
 return {info:info,from:choices[0].source||"playback",query:p.title};
}
module.exports={inspectUrls:inspectUrls,identify:identify};
