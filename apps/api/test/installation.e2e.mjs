/** Starts a fresh production-mode site in a disposable directory. No real accounts, mail or upstream. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const here = dirname(fileURLToPath(import.meta.url)), folder = mkdtempSync(join(tmpdir(), 'qgauss-installation-http-'));
const dbFile = join(folder, 'installation.db');
execFileSync(process.execPath, [join(here, '../prisma/migrate.mjs')], { env: { ...process.env, DATABASE_FILE: dbFile }, stdio: 'pipe' });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + dbFile.replace(/\\/g, '/') } } });
const ownerToken = randomBytes(32).toString('base64url');
const secrets = { JWT_SECRET: randomBytes(48).toString('base64url'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
const password = 'SyntheticHttpOwner-184';
const payload = { requestKey: randomUUID(), email: ' Owner@QGauss.test ', username: 'http_owner', displayName: '合成启航负责人', password, siteBaseUrl: 'https://space.qgauss.test', openRegistration: false };
let child, base, token = '', ip = 10, passed = 0, closing;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('  ✔ ' + name); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const server = createServer(); await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); }); const value = server.address().port; await new Promise(ok => server.close(ok)); return value; }
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const processHandle = child;
  const timer = setTimeout(() => { if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill('SIGKILL'); }, 8000);
  processHandle.kill('SIGTERM');
  try { await closing; } finally { clearTimeout(timer); }
}
async function boot({ setupToken = ownerToken, rejected = false } = {}) {
  const listenPort = await port();
  const env = { ...process.env, ...secrets, NODE_ENV: 'production', DATABASE_URL: 'file:' + dbFile.replace(/\\/g, '/'), PORT: String(listenPort), API_PREFIX: 'api', TRUST_PROXY: 'loopback', CORS_ORIGINS: '', WEB_DIST: join(folder, 'no-web'), STORAGE_DRIVER: 'local', MAIL_SMTP_HOST: '', MAIL_FROM: '', MAIL_SMTP_USER: '', MAIL_SMTP_PASS: '', SEED_ADMIN_PASSWORD: password };
  delete env.QGAUSS_SETUP_TOKEN; if (setupToken != null) env.QGAUSS_SETUP_TOKEN = setupToken;
  child = spawn(process.execPath, ['--require', join(here, 'startup-probe.cjs'), join(here, '../dist/main.js')], { cwd: folder, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; const add = data => { output = (output + data.toString()).slice(-16000); };
  child.stdout.on('data', add); child.stderr.on('data', add);
  closing = new Promise((ok, bad) => { child.once('exit', (code, signal) => ok({ code, signal })); child.once('error', bad); });
  base = 'http://127.0.0.1:' + listenPort + '/api';
  const until = Date.now() + 20000;
  while (Date.now() < until && child.exitCode === null && child.signalCode === null) {
    let ready = false;
    try { ready = (await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) { assert.equal(rejected, false, 'expected startup refusal'); return; }
    await delay(100);
  }
  if (rejected && child.exitCode !== null) { check('新生产站点缺少安装凭证时拒绝启动', /QGAUSS_SETUP_TOKEN/.test(output)); return; }
  throw Error('isolated installation server did not become ready: ' + output);
}
async function call(path, method = 'GET', body, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': options.ip || '198.51.100.' + ip++, 'X-Forwarded-Proto': options.insecure ? 'http' : 'https', ...(options.owner === false ? {} : { 'x-qgauss-install-token': options.owner || ownerToken }), ...(options.authorization === false ? {} : token ? { Authorization: 'Bearer ' + token } : {}) };
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const json = await response.json(); return { status: response.status, data: json.data, json };
}

try {
  await boot({ setupToken: null, rejected: true });
  await boot();
  check('初始化前存活检查可访问', (await call('/health')).status === 200);
  const waiting = await call('/installation/status', 'GET', undefined, { owner: false });
  check('公开状态只返回安装准备事实', waiting.data.required === true && waiting.data.canInitialize === true && Object.keys(waiting.data).length === 3);
  const insecure = await call('/installation/status', 'GET', undefined, { insecure: true });
  check('非安全外部连接不能初始化', insecure.data.canInitialize === false && insecure.data.needsSecureConnection === true);
  for (const path of ['/auth/captcha', '/models/available', '/installation/readiness']) check('等待安装时封闭 ' + path, (await call(path, 'GET', undefined, { owner: false })).status === 503);
  check('等待安装时不能抢先注册普通账户', (await call('/auth/register', 'POST', {})).status === 503);
  check('等待安装时不能绕过安装先登录', (await call('/auth/login', 'POST', { account: 'http_owner', password })).status === 503);
  check('缺少安装凭证先于表单校验被拒绝', (await call('/installation', 'POST', {}, { owner: false })).status === 403);
  check('错误安装凭证不暴露表单校验结果', (await call('/installation', 'POST', {}, { owner: 'synthetic-wrong-install-token' })).status === 403);
  check('有效凭证不能在非安全外部连接创建账户', (await call('/installation', 'POST', payload, { insecure: true })).status === 403);
  for (const extra of [{ password: 123456789012 }, { openRegistration: 'false' }, { displayName: null }, { username: 12345 }]) check('初始化拒绝隐式 JSON 类型转换 ' + Object.keys(extra)[0], (await call('/installation', 'POST', { ...payload, ...extra })).status === 400);
  for (const extra of [{ password: 'OnlyLettersPassword' }, { password: 'A1' + '😀'.repeat(20) }, { siteBaseUrl: 'https://space.qgauss.test/path' }, { siteBaseUrl: 'http://space.qgauss.test' }]) check('初始化拒绝不合规则的密码或站点地址 ' + Object.keys(extra)[0], (await call('/installation', 'POST', { ...payload, ...extra })).status === 422);
  for (let i = 0; i < 5; i++) assert.equal((await call('/installation', 'POST', {}, { ip: '203.0.113.17', owner: false })).status, 403);
  check('安装凭证猜测有独立次数限制', (await call('/installation', 'POST', {}, { ip: '203.0.113.17', owner: false })).status === 429);
  const created = await call('/installation', 'POST', payload);
  check('明确创建后只返回通用回执，不自动登录', created.status === 201 && created.data.initialized === true && !created.data.accessToken && Object.keys(created.data).length === 2);
  const duplicate = await Promise.all([call('/installation', 'POST', payload), call('/installation', 'POST', payload)]);
  check('重复确认同一请求仍只有一个管理员', duplicate.every(value => value.status === 201) && await prisma.user.count() === 1);
  check('更换创建身份不能重用已关闭入口', (await call('/installation', 'POST', { ...payload, requestKey: randomUUID(), email: 'different@qgauss.test' })).status === 409);
  const state = await call('/installation/status', 'GET', undefined, { owner: false });
  check('安装成功后入口状态关闭', state.data.required === false && state.data.canInitialize === false);
  check('启航清单仍要求登录', (await call('/installation/readiness', 'GET', undefined, { owner: false })).status === 401);
  const publicSettings = await call('/settings/public');
  check('新站点默认关闭注册与商业化', publicSettings.data['security.registerEnabled'] === false && publicSettings.data['commerce.enabled'] === false);
  check('公开设置不含安装内部记录', !Object.hasOwn(publicSettings.data, 'installation.state'));
  check('安装完成仍不能自行注册', (await call('/auth/register', 'POST', { email: 'member@qgauss.test', username: 'member_synthetic', password: 'SyntheticMember-813' })).status === 403);
  const loggedIn = await call('/auth/login', 'POST', { account: 'http_owner', password }); token = loggedIn.data?.accessToken;
  check('新管理员可用明确设置的密码登录', loggedIn.status === 201 && !!token && loggedIn.data.user.email === 'owner@qgauss.test');
  const menu = await call('/menus');
  check('无需演示种子即可取得管理员启航菜单', menu.status === 200 && JSON.stringify(menu.data).includes('/welcome'));
  const checks = await call('/installation/readiness');
  check('初始清单如实显示没有对话模型', checks.status === 200 && checks.data.canEnableDemo === true && checks.data.chatModel === null);
  check('没有创作时不伪报首份作品完成', checks.data.checks.find(item => item.id === 'creation').state === 'action');
  check('没有邮件配置时不伪报投递就绪', checks.data.checks.find(item => item.id === 'mail').state === 'optional');
  check('管理员设置页同样不公开内部安装记录', !(await call('/settings')).data.some(row => row.key === 'installation.state'));
  check('明确开启本地体验成功', (await call('/installation/demo', 'POST', {})).status === 201);
  check('重复开启本地体验不增加渠道或模型', (await call('/installation/demo', 'POST', {})).status === 201 && await prisma.channel.count() === 1 && await prisma.aiModel.count() === 1);
  check('开启体验不会自动创建对话', await prisma.message.count() === 0);
  const ready = await call('/installation/readiness');
  check('本地体验明确标记演示与实际计费规则', ready.data.chatModel.demo === true && ready.data.chatModel.billing.mode === 'none');
  const response = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ model: 'qgauss-demo-chat', clientMsgId: randomUUID(), messages: [{ role: 'user', content: '仅验证本地首次创作，不连接外部服务。' }] }), signal: AbortSignal.timeout(20000) });
  const wire = await response.text();
  check('无种子新站点可完成首次本地对话', response.ok && /event: done/.test(wire) && !/event: error/.test(wire));
  check('完成结果保存后才更新首份创作清单', (await call('/installation/readiness')).data.checks.find(item => item.id === 'creation').state === 'ready');
  const memberPassword = 'SyntheticMember-813', member = await prisma.user.create({ data: { email: 'member@qgauss.test', username: 'member_synthetic', passwordHash: await bcrypt.hash(memberPassword, 4) } });
  token = (await call('/auth/login', 'POST', { account: member.username, password: memberPassword }, { authorization: false })).data.accessToken;
  check('普通成员不能读取管理员清单', (await call('/installation/readiness')).status === 403);
  check('普通成员不能开启本地体验', (await call('/installation/demo', 'POST', {})).status === 403);
  await stop(); token = '';
  await boot({ setupToken: null });
  check('重启并移除安装凭证后保留已完成状态', (await call('/installation/status', 'GET', undefined, { owner: false })).data.required === false);
  check('已关闭站点不因重启重新接受初始化', (await call('/installation', 'POST', payload)).status === 403);
  check('重启后原管理员仍可登录', (await call('/auth/login', 'POST', { account: 'http_owner', password })).status === 201);
  console.log(`\n首次安装与启航清单：${passed} 项检查通过`);
} finally {
  await stop(); await prisma.$disconnect();
  const absolute = resolve(folder); if (!absolute.startsWith(resolve(tmpdir()) + sep + 'qgauss-installation-http-')) throw Error('cleanup escaped');
  rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
