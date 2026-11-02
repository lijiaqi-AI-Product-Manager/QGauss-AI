/** 安全边界的真实 HTTP 回归；由 run-e2e.mjs 使用隔离数据库执行。 */
import assert from 'node:assert/strict';

const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
const ADMIN = { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' };
let token = '';
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ✔ ${name}`); }

async function call(path, method = 'GET', body, headers = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

const login = await call('/auth/login', 'POST', ADMIN, { 'X-Forwarded-For': '198.51.100.250' });
assert.equal(login.data.code, 0, '安全套件管理员登录失败');
token = login.data.data.accessToken;
const adminId = login.data.data.user.id;

const publicResult = await call('/health');
check('API 包含 CSP 与防点击劫持响应头', () => {
  assert.match(publicResult.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(publicResult.response.headers.get('x-frame-options'), 'DENY');
  assert.equal(publicResult.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(publicResult.response.headers.get('x-powered-by'), null);
});
check('无 Origin 的健康检查正常返回', () => assert.equal(publicResult.response.status, 200));

const allowed = await call('/health', 'GET', undefined, { Origin: 'https://ui.qgauss.test' });
check('显式白名单来源可以读取 API', () => assert.equal(allowed.response.headers.get('access-control-allow-origin'), 'https://ui.qgauss.test'));
check('Bearer API 不开放 cookie 跨域凭据', () => assert.equal(allowed.response.headers.get('access-control-allow-credentials'), null));
const rejected = await call('/health', 'GET', undefined, { Origin: 'https://untrusted.example' });
check('其他来源没有跨域许可', () => assert.equal(rejected.response.headers.get('access-control-allow-origin'), null));

const staticResponse = await fetch(new URL('/', API), { headers: { Origin: 'https://ui.qgauss.test' } });
const html = await staticResponse.text();
check('SPA 与 API 同样受到 CSP 保护', () => {
  assert.equal(staticResponse.status, 200);
  assert.match(html, /<div id="app">/);
  assert.equal(staticResponse.headers.get('content-security-policy'), publicResult.response.headers.get('content-security-policy'));
});
const assetPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
assert.ok(assetPath, '构建产物缺少脚本入口');
const asset = await fetch(new URL(assetPath, API), { headers: { Origin: 'https://ui.qgauss.test', 'Accept-Encoding': 'gzip' } });
check('预压缩资源保留 Origin 和 Accept-Encoding 两个缓存维度', () => {
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('vary'), /Origin/i);
  assert.match(asset.headers.get('vary'), /Accept-Encoding/i);
});
await asset.arrayBuffer();

const logs = await call(`/users/${adminId}/logins?pageSize=5`);
check('登录日志使用连接地址，不记录伪造的 XFF', () => {
  const latest = logs.data.data.items[0];
  assert.ok(latest);
  assert.match(latest.ip, /^(::ffff:)?127\.0\.0\.1$/);
});

// Multer upgrades must retain bounded error responses instead of crashing the API.
for (const [name, contentType, body] of [
  ['缺少 boundary 的 multipart', 'multipart/form-data', 'invalid multipart'],
  ['文件内容尚未结束的 multipart', 'multipart/form-data; boundary=qgauss-boundary', '--qgauss-boundary\r\nContent-Disposition: form-data; name="file"; filename="incomplete.txt"\r\nContent-Type: text/plain\r\n\r\npartial'],
]) {
  const malformed = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body, signal: AbortSignal.timeout(5000) });
  const data = await malformed.json();
  check(`${name}返回 400，随后 API 仍可用`, () => {
    assert.equal(malformed.status, 400);
    assert.ok(data.message);
  });
}
const afterUploadHealth = await call('/health');
check('异常上传后健康检查仍正常', () => assert.equal(afterUploadHealth.response.status, 200));

const settings = await call('/settings');
const keys = ['security.loginRateLimit', 'security.registerRateLimit', 'security.registerEnabled'];
const original = settings.data.data.filter((row) => keys.includes(row.key)).map(({ key, value }) => ({ key, value }));
async function setSettings(values) {
  const result = await call('/settings', 'PUT', { settings: values });
  assert.equal(result.data.code, 0, '更新安全测试配置失败');
}
try {
  await setSettings([
    { key: 'security.loginRateLimit', value: 2 },
    { key: 'security.registerRateLimit', value: 2 },
    { key: 'security.registerEnabled', value: false },
  ]);
  const loginStatuses = [];
  const registerStatuses = [];
  for (let i = 0; i < 3; i += 1) {
    const headers = { 'X-Forwarded-For': `198.51.100.${i + 1}` };
    loginStatuses.push((await call('/auth/login', 'POST', { account: 'unknown-security-test', password: 'invalid-password' }, headers)).response.status);
    registerStatuses.push((await call('/auth/register', 'POST', { email: `security${i}@example.test`, username: `security_test_${i}`, password: 'invalid-password' }, headers)).response.status);
  }
  check('轮换伪造 XFF 仍触发登录 429', () => assert.deepEqual(loginStatuses, [401, 401, 429]));
  check('轮换伪造 XFF 仍触发注册 429', () => assert.deepEqual(registerStatuses, [403, 403, 429]));
} finally {
  await setSettings(original);
}
console.log(`\n安全回归：${passed} 通过 / 0 失败`);
