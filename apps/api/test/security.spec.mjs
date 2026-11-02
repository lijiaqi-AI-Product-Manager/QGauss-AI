import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { corsOrigins, decodeEncryptionKey, parseTrustProxy, validateEnvironment, validateSeedAdminPassword } from '../dist/common/config/env.check.js';
import { securityHeaders } from '../dist/common/net/security-headers.js';
import { SecretBox } from '../dist/common/crypto/secret-box.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';

const productionEnv = () => ({
  NODE_ENV: 'production',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

test('配置：生产接受独立随机密钥；开发仍需显式 JWT_SECRET', () => {
  const env = productionEnv();
  assert.equal(validateEnvironment(env), env);
  assert.doesNotThrow(() => validateEnvironment({ NODE_ENV: 'development', JWT_SECRET: 'local-test' }));
  assert.throws(() => validateEnvironment({ NODE_ENV: 'development' }), /JWT_SECRET/);
});

test('配置：生产拒绝空、过短、示例和重复字符 JWT 密钥', () => {
  for (const value of [undefined, '', 'short', 'change-me', 'dev-secret', 'please-change-this-in-production', 'x'.repeat(40), 'change-me-'.repeat(5)]) {
    assert.throws(() => validateEnvironment({ ...productionEnv(), JWT_SECRET: value }), /JWT_SECRET/);
  }
});

test('配置：生产加密 Key 必填且必须是标准的随机 32 字节 base64', () => {
  for (const value of [undefined, '', 'invalid', randomBytes(31).toString('base64'), randomBytes(33).toString('base64'), randomBytes(32).toString('base64').slice(0, -1), Buffer.alloc(32).toString('base64')]) {
    assert.throws(() => validateEnvironment({ ...productionEnv(), APP_ENCRYPTION_KEY: value }), /APP_ENCRYPTION_KEY/);
  }
  const key = randomBytes(32);
  assert.deepEqual(decodeEncryptionKey(key.toString('base64')), key);
});

test('配置：JWT 和上游加密密钥不能共用', () => {
  const key = randomBytes(32).toString('base64');
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production', JWT_SECRET: key, APP_ENCRYPTION_KEY: key }), /独立密钥/);
});

test('配置：报错不泄露传入的密钥', () => {
  const secret = 'private-short-key';
  assert.throws(() => validateEnvironment({ ...productionEnv(), JWT_SECRET: secret }), (error) => !error.message.includes(secret));
});

test('生产进程：错误配置在监听端口和访问数据库之前以非零码退出', async () => {
  const apiRoot = fileURLToPath(new URL('..', import.meta.url));
  for (const overrides of [{ JWT_SECRET: '' }, { JWT_SECRET: 'please-change-this-in-production' }, { APP_ENCRYPTION_KEY: 'invalid' }]) {
    // 异步收集输出，让测试运行器持续处理子进程与日志事件。
    const child = await new Promise((resolve) => {
      const proc = spawn(process.execPath, ['dist/main.js'], {
        cwd: apiRoot,
        env: { ...process.env, ...productionEnv(), PORT: '0', DATABASE_URL: 'invalid-before-db', SEED_ADMIN_PASSWORD: 'Admin-Example-987!', ...overrides },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', finished = false;
      const finish = (result) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ stdout, stderr, ...result }); };
      // 独立诊断约 44 秒，Windows 保留 60 秒上限，仍严格校验错误原因和未监听。
      const timer = setTimeout(() => { proc.kill(); finish({ error: new Error('生产配置探针启动超时'), status: null }); }, process.platform === 'win32' ? 60_000 : 15_000);
      proc.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      proc.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      proc.once('error', error => finish({ error, status: null }));
      proc.once('close', status => finish({ error: null, status }));
    });
    assert.ifError(child.error);
    assert.notEqual(child.status, 0);
    assert.match(child.stdout + child.stderr, new RegExp(Object.keys(overrides)[0]));
    assert.doesNotMatch(child.stdout + child.stderr, /QGauss AI ready/);
  }
});

test('配置：生产 seed 拒绝默认密码，强密码可用；不要求已有站点重复 seed', () => {
  for (const password of [undefined, '', 'admin123456', 'a1'.repeat(5), 'a'.repeat(14), '1'.repeat(14), 'change-me-123456', 'a1'.repeat(17)]) {
    assert.throws(() => validateSeedAdminPassword(password, 'production'), /SEED_ADMIN_PASSWORD/);
  }
  assert.doesNotThrow(() => validateSeedAdminPassword('Admin-Example-987!', 'production'));
  assert.doesNotThrow(() => validateSeedAdminPassword(undefined, 'development'));
  assert.doesNotThrow(() => validateEnvironment(productionEnv()));
  assert.throws(() => validateEnvironment({ ...productionEnv(), SEED_ADMIN_PASSWORD: 'admin123456' }), /SEED_ADMIN_PASSWORD/);
});

test('加密：显式错误配置不再静默派生另一把 Key；正确 Key 可解密', () => {
  assert.throws(() => new SecretBox('invalid', 'local'), /APP_ENCRYPTION_KEY/);
  const box = new SecretBox(randomBytes(32).toString('base64'));
  assert.equal(box.decrypt(box.encrypt('upstream-secret')), 'upstream-secret');
});

test('代理：默认关闭，接受明确 IPv4/IPv6/CIDR', () => {
  for (const value of [undefined, '', 'false', '0']) assert.equal(parseTrustProxy(value), false);
  assert.deepEqual(parseTrustProxy('loopback, 10.0.0.4/32, ::1/128'), ['loopback', '10.0.0.4/32', '::1/128']);
});

test('代理：拒绝信任所有代理、跳数和无效网段', () => {
  for (const value of ['true', '1', '*', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', 'not-an-ip', 'loopback,', '127.0.0.1/-1']) {
    assert.throws(() => parseTrustProxy(value), /TRUST_PROXY/);
  }
});

test('CORS：生产默认仅同源，开发允许本机开发服务器', () => {
  assert.deepEqual(corsOrigins('', true), []);
  assert.deepEqual(corsOrigins(undefined), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.deepEqual(corsOrigins('https://ui.example.com, http://localhost:5174', true), ['https://ui.example.com', 'http://localhost:5174']);
});

test('CORS：拒绝通配符、null、路径、凭据和非 HTTP 来源', () => {
  for (const value of ['*', 'null', 'https://example.com/path', 'https://example.com/', 'https://user:pass@example.com', 'file:///tmp', 'https://example.com?x=1']) {
    assert.throws(() => corsOrigins(value, true), /CORS_ORIGINS/);
  }
});

async function serve(t, trust = false, production = false) {
  const app = express();
  app.set('trust proxy', trust);
  app.use(securityHeaders(production));
  app.use(cors({ origin: corsOrigins('https://ui.qgauss.test', true), credentials: false }));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('请求：默认忽略伪造 XFF，未被信任的代理同样不能传递客户端地址', async (t) => {
  for (const trust of [false, parseTrustProxy('10.0.0.4')]) {
    const base = await serve(t, trust);
    const response = await fetch(base, { headers: { 'X-Forwarded-For': '198.51.100.1' } });
    assert.equal((await response.json()).ip, '127.0.0.1');
  }
});

test('请求：可信代理从右向左解析，在最近的不可信地址处停止', async (t) => {
  const base = await serve(t, parseTrustProxy('loopback'));
  const response = await fetch(base, { headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.9' } });
  assert.equal((await response.json()).ip, '203.0.113.9');
});

test('请求：显式配置的多层代理链可得到真实客户端地址', async (t) => {
  const base = await serve(t, parseTrustProxy('loopback,203.0.113.0/24'));
  const response = await fetch(base, { headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.9' } });
  assert.equal((await response.json()).ip, '198.51.100.1');
});

test('响应：白名单预检通过，其他来源不返回跨域许可，不启用 cookie 凭据', async (t) => {
  const base = await serve(t);
  const allowed = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://ui.qgauss.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization,Content-Type' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://ui.qgauss.test');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  const rejected = await fetch(base, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  assert.equal(rejected.status, 200);
});

test('响应：CSP 禁止内联脚本但保留组件样式，HSTS 只在生产启用', async (t) => {
  for (const production of [false, true]) {
    const base = await serve(t, false, production);
    const response = await fetch(base);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('strict-transport-security'), production ? 'max-age=31536000' : null);
  }
});

function authWithAdmins(mode, admins) {
  return new AuthService({ user: { findMany: async () => admins } }, null, { get: () => mode }, null, null, null, null);
}

test('管理员：生产拒绝老数据库中的默认密码，已改密的账号可以启动', async () => {
  const passwordHash = await bcrypt.hash('admin123456', 4);
  await assert.rejects(authWithAdmins('production', [{ passwordHash }]).onModuleInit(), /默认密码/);
  await assert.doesNotReject(authWithAdmins('development', [{ passwordHash }]).onModuleInit());
  const changed = await bcrypt.hash('Admin-Example-987!', 4);
  await assert.doesNotReject(authWithAdmins('production', [{ passwordHash: changed }]).onModuleInit());
});
