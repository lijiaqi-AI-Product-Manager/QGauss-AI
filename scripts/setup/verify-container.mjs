import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const suffix = randomBytes(8).toString('hex');
const name = 'qgauss-container-check-' + suffix;
const volume = name + '-data';
const image = 'qgauss-container-check:' + suffix;
const environment = {
  ...process.env,
  JWT_SECRET: randomBytes(48).toString('base64url'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  QGAUSS_SETUP_TOKEN: randomBytes(32).toString('base64url'),
  QGAUSS_TEST_PASSWORD: 'QGauss9-' + randomBytes(8).toString('hex'),
};
const run = (args, options = {}) => spawnSync('docker', args, {
  cwd: root, env: environment, windowsHide: true, encoding: 'utf8',
  timeout: 15_000, ...options,
});
function step(args, label, options) {
  const result = run(args, options);
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message;
    throw new Error(detail ? label + '。' + detail : label);
  }
  return result.stdout?.trim();
}

const inside = String.raw`
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:9520';
const password = process.env.QGAUSS_TEST_PASSWORD;
const firstBoot = Boolean(process.env.QGAUSS_SETUP_TOKEN);
let token;
async function call(path, { method = 'GET', body, owner, expected = 200 } = {}) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }),
      ...(owner && { 'x-qgauss-install-token': owner }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, expected, path);
  const value = await response.json();
  return value.data ?? value;
}

const page = await fetch(base + (firstBoot ? '/setup' : '/welcome'), { signal: AbortSignal.timeout(5_000) });
assert.equal(page.status, 200);
const entry = /<script[^>]*src="(\/assets\/[^"?]+\.js)"/.exec(await page.text())?.[1];
assert.ok(entry, 'built web entry');
assert.equal((await fetch(base + entry, { signal: AbortSignal.timeout(5_000) })).status, 200);
assert.equal((await call('/installation/status', { owner: process.env.QGAUSS_SETUP_TOKEN })).required, firstBoot);
if (firstBoot) {
  await call('/installation', {
    method: 'POST', expected: 201, owner: process.env.QGAUSS_SETUP_TOKEN,
    body: { requestKey: randomUUID(), email: 'container-owner@qgauss.test', username: 'container_owner',
      displayName: 'QGauss Test Owner', password, siteBaseUrl: 'https://workspace.qgauss.test', openRegistration: false },
  });
}

const account = await call('/auth/login', { method: 'POST', expected: 201, body: { account: 'container_owner', password } });
assert.equal(account.user.role, 'ADMIN');
token = account.accessToken;
const ready = await call('/installation/readiness');
assert.equal(ready.launch.registration.mode, 'admin');
assert.equal(ready.launch.payments.state, 'closed');
assert.equal(ready.launch.liveChatConfigured, false);
if (firstBoot) {
  assert.equal(ready.chatModel, null);
  await call('/installation/demo', { method: 'POST', expected: 201, body: {} });
  const response = await fetch(base + '/api/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ model: 'qgauss-demo-chat', clientMsgId: randomUUID(),
      messages: [{ role: 'user', content: 'QGauss offline installation check' }] }),
    signal: AbortSignal.timeout(20_000),
  });
  const events = await response.text();
  assert.equal(response.ok, true);
  assert.match(events, /event: done/);
  assert.doesNotMatch(events, /event: error/);
} else {
  assert.equal(ready.chatModel.demo, true);
  assert.equal(ready.checks.find(check => check.id === 'creation')?.state, 'ready');
}
console.log(firstBoot ? '容器首次安装、登录和本地创作通过' : '容器重新启动及原创作保留通过');
`;

const healthy = 'fetch("http://127.0.0.1:9520/api/health",{signal:AbortSignal.timeout(1500)}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})';
async function verifyBoot(firstBoot) {
  const setup = firstBoot ? ['--env', 'QGAUSS_SETUP_TOKEN'] : [];
  step(['run', '--detach', '--network', 'none', '--name', name, '--mount', 'type=volume,source=' + volume + ',target=/app/data',
    '--env', 'DATABASE_URL=file:/app/data/qgauss.db', '--env', 'JWT_SECRET', '--env', 'APP_ENCRYPTION_KEY', ...setup, image], '无法启动独立验收容器');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (run(['exec', name, 'node', '-e', healthy], { timeout: 5_000 }).status === 0) {
      console.log(step(['exec', '-i', '--env', 'QGAUSS_TEST_PASSWORD', name, 'node', '--input-type=module', '-'],
        '容器内操作未通过', { input: inside, timeout: 60_000 }));
      return;
    }
    const state = step(['container', 'inspect', '--format', '{{.State.Status}}', name], '无法读取验收容器状态');
    if (state === 'exited' || state === 'dead') break;
    await delay(500);
  }
  const logs = step(['logs', '--tail', '18', name], '无法读取验收容器启动日志');
  throw new Error('容器未达到健康状态。\n' + logs);
}

const engine = run(['version', '--format', '{{.Server.Version}}']);
if (engine.status !== 0) throw new Error('容器验收需要可用的 Docker 引擎。');
try {
  step(['build', '--tag', image, '.'], '验收镜像构建失败', { stdio: 'inherit', timeout: 900_000 });
  step(['volume', 'create', volume], '无法新建独立验收数据卷');
  await verifyBoot(true);
  step(['container', 'rm', '-f', name], '无法停止首次验收容器');
  await verifyBoot(false);
} finally {
  run(['container', 'rm', '-f', name]);
  run(['volume', 'rm', volume]);
  run(['image', 'rm', image]);
}
