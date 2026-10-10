const assert = require("node:assert/strict");
const plugin = require("../trakt.js");
const expired = JSON.stringify({access_token:"expired",refresh_token:"rotating",
  created_at:1,expires_in:3600});
let refreshes=0, writes=0, profileCalls=0;
let keychain = expired;
const file = {};
plugin.configure({
  file: {exists:p=>Object.hasOwn(file,p),read:p=>file[p],write:(p,v)=>file[p]=v},
  preferences: {get(){return undefined;}},
  logger(){}, notify(){},
  apiGate: {request(_method,send){return send();},status(){return {mode:"online",retryInSeconds:0};}},
  utils: {
    keyChainRead(){return keychain;},
    keyChainWrite(_service,_account,value){keychain=value;writes++;return true;},
    async exec(_binary,args) {
      const url = args[args.length-1];
      if (url.endsWith("/oauth/token")) {
        refreshes++;
        await new Promise(resolve=>setTimeout(resolve,25));
        const now=Math.floor(Date.now()/1000);
        return {status:0,stderr:"",stdout:JSON.stringify({
          access_token:"new-token",refresh_token:"new-refresh",
          created_at:now,expires_in:3600
        })+"\n__IINA_TRAKT_STATUS__:200"};
      }
      if (url.includes("/users/settings")) {
        profileCalls++;
        return {status:0,stderr:"",stdout:JSON.stringify({
          user:{username:"demo",ids:{slug:"demo"}}
        })+"\n__IINA_TRAKT_STATUS__:200"};
      }
      throw Error("Unexpected url "+url);
    }
  }
});
(async function(){
  const profiles=await Promise.all([
    plugin.getViewerProfile({force:true}),
    plugin.getViewerProfile({force:true}),
    plugin.getViewerProfile({force:true})
  ]);
  assert.equal(refreshes,1,"one token refresh for simultaneous callers");
  assert.equal(writes,1,"one new keychain token");
  assert.ok(profiles.every(x=>x&&x.username==="demo"));
  assert.equal(profileCalls,3,"requests may proceed after refresh");
  console.log("OAuth single-flight refresh test passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
