// Integration regression: a real Trakt 429/Cloudflare response must not sign out
// a user whose existing OAuth refresh token was temporarily unable to refresh.
const assert = require("node:assert/strict");
const path = require("node:path");
const token = JSON.stringify({access_token:"expired",refresh_token:"keep-me",
  created_at:1,expires_in:3600});
const files = {"@data/trakt-token.json":token};
const keychainWrites = [], requests = [];
const plugin = require("../trakt.js");
plugin.configure({
  file:{
    exists(p){return Object.hasOwn(files,p);},
    read(p){return files[p];},
    write(p,s){files[p]=String(s);}
  },
  preferences:{get(){return undefined;}},
  logger(){},
  notify(){},
  utils:{
    keyChainRead(){return token;},
    keyChainWrite(service, account, value){keychainWrites.push(value);return true;},
    async exec(bin, args){
      const url = args[args.length-1];
      requests.push(url);
      assert.ok(url.includes("/oauth/token"));
      return {status:0,stderr:"",stdout:
        "HTTP/2 429\r\nretry-after: 73\r\ncontent-type: application/json\r\n\r\n"+
        '{"error":"rate_limited"}\n__IINA_TRAKT_STATUS__:429'};
    }
  }
});
(async()=>{
  await assert.rejects(plugin.getViewerProfile(), e=>e.code==="TRAKT_COOLDOWN");
  assert.equal(plugin.getApiStatus().mode,"rate_limited");
  assert.ok(plugin.getApiStatus().retryInSeconds>=73);
  assert.equal(files["@data/trakt-token.json"],token);
  assert.equal(keychainWrites.length,0,"Never erase keychain during rate limit");
  assert.equal(plugin.getAuthStatus().state,"connected");
  await assert.rejects(plugin.getViewerProfile({force:true}), e=>e.code==="TRAKT_COOLDOWN");
  assert.equal(requests.length,1,"Second request must be blocked without touching Trakt");
  console.log("Trakt 429 + OAuth preservation integration passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
