// Manual correction media type is chosen by the user, not locked to the
// parser's guess. Keep playback identity immutable until Trakt verifies a pick.
function preferredKind(info, episodeRoute) {
  return episodeRoute || (info && info.type === "episode") ? "episode" : "movie";
}
function episodePosition(info, route) {
  var media=info||{},r=route||{};
  var s=Number.isInteger(r.season)?r.season:media.season;
  var e=Number.isInteger(r.episode)?r.episode:media.episode;
  return {season:Number.isInteger(s)?String(s):"",
    episode:Number.isInteger(e)?String(e):""};
}
function searchMedia(info, kind, route) {
  var media=info||{}, selected=kind==="episode"?"episode":"movie";
  if(selected==="movie"){
    return {type:"movie",title:String(media.title||media.episodeTitle||"").trim(),
      year:media.type==="movie"?media.year||null:null};
  }
  var pos=episodePosition(media,route);
  return {type:"episode",title:String(media.showTitle||media.title||"Unknown Series"),
    showTitle:String(media.showTitle||media.title||"Unknown Series"),
    season:pos.season===""?null:Number(pos.season),
    episode:pos.episode===""?null:Number(pos.episode),
    episodeTitle:String(media.episodeTitle||(media.type==="movie"?media.title:"")||"")};
}
function selectMedia(info, kind, candidate, season, episode) {
  var selected=kind==="episode"?"episode":"movie",base=info||{},c=candidate||{};
  if(selected==="movie"){
    if(c.kind!=="movie"||!c.title)throw Error("Select a movie result.");
    return {type:"movie",title:String(c.title),year:c.year||null,imdb:"",
      unresolvedShow:false,manualTraktId:0};
  }
  if(c.kind!=="episode"||!c.title)throw Error("Select a TV series result.");
  if(season===""||episode===""||season===null||episode===null)
    throw Error("Enter Season and Episode.");
  var s=Number(season),e=Number(episode);
  if(!Number.isInteger(s)||s<0||s>100||!Number.isInteger(e)||e<1||e>9999)
    throw Error("Enter a valid Season (0–100) and Episode (1–9999).");
  return {type:"episode",title:String(c.title),showTitle:String(c.title),
    season:s,episode:e,year:c.year||null,
    episodeTitle:String(base.episodeTitle||(base.type==="movie"?base.title:"")||""),
    unresolvedShow:false,manualTraktId:Number(c.trakt)||0,imdb:""};
}
module.exports={preferredKind:preferredKind,episodePosition:episodePosition,
 searchMedia:searchMedia,selectMedia:selectMedia};