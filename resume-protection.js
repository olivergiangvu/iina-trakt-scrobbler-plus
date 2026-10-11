// Fail-closed progress gate: never overwrite a Trakt resume checkpoint with
// an IINA launch that starts behind it. Deliberately does not auto-rewind.
var GAP_PERCENT=1.5, MIN_REMOTE=1.0;
function validPercent(n){return typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100;}
function assess(remote,local) {
  if(remote===null) return {blocked:false,reason:"no-existing-resume",resumePercent:null};
  if(!validPercent(remote))return {blocked:true,reason:"resume-unavailable",resumePercent:null};
  if(!validPercent(local))return {blocked:true,reason:"position-unavailable",resumePercent:remote};
  if(remote>=MIN_REMOTE && remote-local>GAP_PERCENT)
    return {blocked:true,reason:"remote-ahead",resumePercent:remote};
  return {blocked:false,reason:"at-or-ahead-of-resume",resumePercent:remote};
}
function create() {
  var state={status:"checking",resumePercent:null,message:"Checking Trakt resume before sending playback…"};
  function update(result){
    if(!result || result.status!=="ok"){
      state={status:"unavailable",resumePercent:null,
        message:"Trakt resume could not be checked; outgoing scrobble blocked."};
      return state;
    }
    var p=result.progress;
    if(p!==null&&!validPercent(p))return update(null);
    state={status:"ready",resumePercent:p,
      message:p===null?"No prior Trakt resume checkpoint.":
        "Trakt resume checkpoint: "+p.toFixed(1)+"%."};
    return state;
  }
  function decision(local) {
    if(state.status!=="ready")return {blocked:true,
      reason:state.status==="checking"?"resume-check-pending":"resume-check-unavailable",
      resumePercent:null};
    return assess(state.resumePercent,local);
  }
  function snapshot(){return Object.assign({},state);}
  return {update:update,decision:decision,snapshot:snapshot};
}
module.exports={create:create,assess:assess};