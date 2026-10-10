const assert = require("node:assert/strict");
const {create} = require("../trakt-api-gate.js");
async function run() {
  let now = 1000000, delays = [], calls = 0, db = {};
  const file = {exists:p=>Object.hasOwn(db,p),read:p=>db[p],write:(p,v)=>db[p]=v};
  function setup() {
    return create({file,now:()=>now,writeGapMs:1350,wait:async ms=>{delays.push(ms);now+=ms;}});
  }
  let guard = setup();
  const good = async()=>{calls++;return {statusCode:201,body:{action:"start"}};};
  await Promise.all([guard.request("POST",good),guard.request("POST",good),guard.request("POST",good)]);
  assert.equal(calls,3);
  assert.deepEqual(delays,[1350,1350],"all writes serialized and paced");
  assert.equal(guard.status().queuedWrites,0);
  const tooMany = async()=>({statusCode:429,headers:{"retry-after":"65"},rawBody:"429"});
  await assert.rejects(guard.request("POST",tooMany),e=>e.code==="TRAKT_COOLDOWN" && e.retryInSeconds>=65);
  assert.equal(guard.status().mode,"rate_limited");
  await assert.rejects(guard.request("GET",good),e=>e.code==="TRAKT_COOLDOWN");
  assert.equal(calls,3,"no extra requests during cooldown");
  guard = setup(); // persisted cooldown after relaunch
  assert.equal(guard.status().mode,"rate_limited");
  now+=66000;
  assert.equal(guard.status().mode,"online");
  const cf = async()=>({statusCode:403,headers:{},rawBody:"<html>Error code: 1015</html>"});
  await assert.rejects(guard.request("POST",cf),e=>e.reason==="cloudflare_1015");
  assert.ok(guard.status().retryInSeconds>=120);
  now+=121000;
  await guard.request("GET",good);
  assert.equal(guard.status().mode,"online");
  const failed = async()=>{throw new Error("connection refused");};
  await assert.rejects(guard.request("GET",failed),/connection refused/);
  assert.equal(guard.status().mode,"offline");
  await assert.rejects(guard.request("GET",good),e=>e.code==="TRAKT_OFFLINE");
  now+=16000;
  await guard.request("GET",good);
  assert.equal(guard.status().mode,"online");
  console.log("Trakt API gate tests passed");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
