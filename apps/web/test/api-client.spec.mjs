import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, setAccessToken, setRefreshHandler } from '../src/api/client.js';
const json=(data,status=200)=>new Response(JSON.stringify(status<400?{code:0,data}:{code:status,message:'登录已失效'}),{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>{setAccessToken('');setRefreshHandler(null);});
test('a delayed 401 from a former account cannot refresh or replay a mutation as the new account',async()=>{
  let finish,refreshes=0;const calls=[];setAccessToken('former-account');setRefreshHandler(async()=>{refreshes++;setAccessToken('new-account-refreshed');return true;});
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Promise(done=>finish=done);};
  const pending=api.patch('/users/profile',{displayName:'Former draft'});setAccessToken('new-account');finish(json(null,401));
  await assert.rejects(()=>pending,error=>error.status===401);assert.equal(refreshes,0);assert.equal(calls.length,1);assert.equal(calls[0].init.headers.Authorization,'Bearer former-account');
});
test('a same-account 401 can refresh once and retry the original request with the renewed credential',async()=>{
  const calls=[];setAccessToken('before-renewal','same-session');setRefreshHandler(async()=>{setAccessToken('after-renewal','same-session');return true;});
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return calls.length===1?json(null,401):json({ok:true});};
  assert.deepEqual(await api.get('/users/profile'),{ok:true});assert.equal(calls.length,2);assert.equal(calls[1].init.headers.Authorization,'Bearer after-renewal');
});
test('sensitive form requests can explicitly disable automatic replay and pass cancellation to PATCH',async()=>{
  const controller=new AbortController();let refreshes=0,received;setAccessToken('same-account');setRefreshHandler(async()=>{refreshes++;return true;});
  globalThis.fetch=async(_url,init)=>{received=init;return json(null,401);};
  await assert.rejects(()=>api.patch('/users/profile',{displayName:'Draft'},{retry:false,signal:controller.signal}),error=>error.status===401);
  assert.equal(refreshes,0);assert.equal(received.signal,controller.signal);
});
test('cancellation while waiting for renewal prevents a replacement request',async()=>{
  const controller=new AbortController();let finish,started;const ready=new Promise(done=>started=done);let count=0;setAccessToken('same-account');
  globalThis.fetch=async()=>{count++;return json(null,401);};setRefreshHandler(()=>{started();return new Promise(done=>finish=done);});
  const pending=api.post('/users/password',{oldPassword:'SyntheticOld-123',newPassword:'SyntheticNew-456'},{signal:controller.signal});await ready;controller.abort();setAccessToken('renewed');finish(true);
  await assert.rejects(()=>pending,error=>error.status===401);assert.equal(count,1);
});

test('an older 401 can use an already renewed credential from the same login without a second renewal',async()=>{
  const calls=[];let finish,refreshes=0;setAccessToken('before','same-session');setRefreshHandler(async()=>{refreshes++;return true;});
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return calls.length===1?new Promise(done=>finish=done):json({ok:true});};
  const pending=api.get('/users/profile');setAccessToken('after','same-session');finish(json(null,401));assert.deepEqual(await pending,{ok:true});assert.equal(refreshes,0);assert.equal(calls.length,2);assert.equal(calls[1].init.headers.Authorization,'Bearer after');
});
test('account replacement during renewal prevents the former mutation from being replayed',async()=>{
  let finish,started,count=0;const ready=new Promise(done=>started=done);setAccessToken('former','former-session');globalThis.fetch=async()=>{count++;return json(null,401);};setRefreshHandler(()=>{started();return new Promise(done=>finish=done);});
  const pending=api.patch('/users/profile',{displayName:'Former draft'});await ready;setAccessToken('new','new-session');finish(true);await assert.rejects(()=>pending,error=>error.status===401);assert.equal(count,1);
});
