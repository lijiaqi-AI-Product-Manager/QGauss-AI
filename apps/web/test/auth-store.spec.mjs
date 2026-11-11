import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 最小 localStorage：auth store 只用 get/set/remove
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => session.get(k) ?? null,
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
};

const { createPinia, setActivePinia } = await import('pinia');
const { useAuth } = await import('../src/stores/auth.js');

const KEY = 'qg:refresh';
let calls;

function okResponse(token) {
  return {
    ok: true,
    status: 201,
    json: async () => ({ code: 0, data: { accessToken: `at-${token}`, refreshToken: token, user: { id: 'u1' } } }),
  };
}

beforeEach(() => {
  storage.clear();
  session.clear();
  calls = [];
  setActivePinia(createPinia());
});

test('phone sign-in accepts an empty email contact and persists only a complete reviewed session',()=>{
  const auth=useAuth();auth.acceptLogin({accessToken:'phone-access',refreshToken:'phone-refresh',user:{id:'phone-user',email:null}},{remember:false});assert.equal(auth.user.email,null);assert.equal(session.get(KEY),'phone-refresh');assert.equal(storage.get(KEY),undefined);
  for(const data of [{accessToken:'incomplete'},{accessToken:'new',refreshToken:'new',user:{id:''}}])assert.throws(()=>auth.acceptLogin(data),/登录结果不完整/);assert.equal(auth.user.id,'phone-user');assert.equal(auth.accessToken,'phone-access');
});

test('网络中断不算登录失效：令牌保留，不清用户', async () => {
  storage.set(KEY, 'r1');
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const auth = useAuth();
  auth.user = { id: 'u1' };
  assert.equal(await auth.refresh(), false);
  assert.equal(storage.get(KEY), 'r1');
  assert.deepEqual(auth.user, { id: 'u1' });
});

test('credential renewal preserves account identity while a fresh sign-in changes it', async () => {
  const auth=useAuth();auth.apply({accessToken:'a1',refreshToken:'r1',user:{id:'u1'}});const identity=auth.identityRevision,revision=auth.sessionRevision;
  globalThis.fetch=async()=>okResponse('r2');assert.equal(await auth.refresh(),true);assert.equal(auth.identityRevision,identity);assert.ok(auth.sessionRevision>revision);
  auth.apply({accessToken:'a3',refreshToken:'r3',user:{id:'u1'}});assert.ok(auth.identityRevision>identity);
});
test('password-change notice contains only a known status and clears after sign-in', async () => {
  const auth=useAuth();auth.apply({accessToken:'a',refreshToken:'r',user:{id:'u1'}});auth.clearLocal('password-changed');assert.equal(auth.sessionNotice,'password-changed');assert.equal(auth.isLoggedIn,false);
  globalThis.fetch=async()=>({ok:true,status:201,text:async()=>JSON.stringify({code:0,data:{accessToken:'new',refreshToken:'new-r',user:{id:'u1'}}})});
  await auth.login('synthetic-account','SyntheticPass-123');assert.equal(auth.sessionNotice,'');auth.clearLocal('arbitrary-message');assert.equal(auth.sessionNotice,'');
});
test('logout clears local state before sending only the old refresh credential to the public revocation endpoint', async () => {
  const auth=useAuth();auth.apply({accessToken:'old-a',refreshToken:'old-r',user:{id:'u1'}});let observed;
  globalThis.fetch=async(url,options)=>{observed={url,options,loggedIn:auth.isLoggedIn};return{ok:true};};await auth.logout();
  assert.equal(observed.loggedIn,false);assert.equal(observed.url,'/api/auth/logout');assert.deepEqual(JSON.parse(observed.options.body),{refreshToken:'old-r'});assert.equal(observed.options.keepalive,true);
});

test('服务端 5xx 同样不登出', async () => {
  storage.set(KEY, 'r1');
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const auth = useAuth();
  assert.equal(await auth.refresh(), false);
  assert.equal(storage.get(KEY), 'r1');
});

test('服务端 401 才清掉本地令牌', async () => {
  storage.set(KEY, 'r1');
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const auth = useAuth();
  auth.user = { id: 'u1' };
  assert.equal(await auth.refresh(), false);
  assert.equal(storage.has(KEY), false);
  assert.equal(auth.user, null);
});

test('并发刷新只发一个请求', async () => {
  storage.set(KEY, 'r1');
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).refreshToken);
    await new Promise((r) => setTimeout(r, 20));
    return okResponse('r2');
  };
  const auth = useAuth();
  const results = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
  assert.deepEqual(results, [true, true, true]);
  assert.deepEqual(calls, ['r1']);
  assert.equal(storage.get(KEY), 'r2');
});

test('以存储里最新的令牌为准（别的标签页已轮换）', async () => {
  storage.set(KEY, 'r1');
  const auth = useAuth();
  assert.equal(auth.refreshToken, 'r1');
  storage.set(KEY, 'r9'); // 另一个标签页刚刷新过
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body).refreshToken);
    return okResponse('r10');
  };
  assert.equal(await auth.refresh(), true);
  assert.deepEqual(calls, ['r9']);
});

test('取消记住登录：只写本标签页 sessionStorage，不在 localStorage 留令牌', async () => {
  const data = { accessToken: 'access', refreshToken: 'session-only', user: { id: 'u1' } };
  globalThis.fetch = async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ code: 0, data }) });
  storage.set(KEY, 'previous-persistent');
  const auth = useAuth();
  await auth.login('admin', 'test-password', { remember: false });
  assert.equal(storage.has(KEY), false);
  assert.equal(session.get(KEY), 'session-only');
  assert.equal(auth.remember, false);
});

test('仅本次会话登录：刷新页面恢复本标签页令牌，轮换后仍不持久保存', async () => {
  session.set(KEY, 'session-r1');
  storage.set(KEY, 'another-tab-r1');
  const auth = useAuth();
  globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(init.body).refreshToken); return okResponse('session-r2'); };
  assert.equal(auth.remember, false);
  assert.equal(await auth.refresh(), true);
  assert.deepEqual(calls, ['session-r1']);
  assert.equal(session.get(KEY), 'session-r2');
  assert.equal(storage.get(KEY), 'another-tab-r1');
});

test('仅本次会话登出：清本标签页令牌，不删除其他标签页的持久会话', async () => {
  session.set(KEY, 'session-r1');
  storage.set(KEY, 'another-tab-r1');
  const auth = useAuth();
  auth.clearLocal();
  assert.equal(session.has(KEY), false);
  assert.equal(storage.get(KEY), 'another-tab-r1');
  assert.equal(auth.refreshToken, '');
});

test('刷新请求在登出后才返回：不能恢复已经退出的会话', async () => {
  storage.set(KEY, 'r1');
  let finish;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const auth = useAuth();
  const pending = auth.refresh();
  auth.clearLocal();
  finish(okResponse('late-r2'));
  assert.equal(await pending, false);
  assert.equal(auth.user, null);
  assert.equal(auth.accessToken, '');
  assert.equal(storage.has(KEY), false);
});

test('旧会话刷新失败：不能清除已切换的新账号', async () => {
  storage.set(KEY, 'old-r1');
  let finish;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const auth = useAuth();
  const pending = auth.refresh();
  auth.apply({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id: 'u2' } });
  finish({ status: 401, ok: false });
  assert.equal(await pending, false);
  assert.equal(auth.user.id, 'u2');
  assert.equal(storage.get(KEY), 'new-refresh');
});
