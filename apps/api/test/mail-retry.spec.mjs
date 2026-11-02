/** Real SQLite claims and durable receipts; transports here are controlled local functions. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mailFixtures, mailSettles } from './mail-fixture.mjs';
import { classifyMailFailure, maskedMailbox } from '../dist/modules/mail/mail-receipt.js';
import { mailTransportConfiguration } from '../dist/modules/mail/mail-config.js';

const fixtures = mailFixtures(); after(() => fixtures.close());
const bind = (service, sendMail) => { service.transporter = { sendMail, close() {} }; return service; };
const accepted = async message => ({ accepted: [message.to] });
async function queued(f, extra = {}) { return f.prisma.mailOutbox.create({ data: { to: f.user.email, template: 'welcome', subject: 'obsolete', body: '<script>cached unsafe</script>', payload: JSON.stringify({ username: '<b>小高</b>' }), status: 'queued', ...extra } }); }

test('未配置邮件只保存记录，不启动连接或定时器，也不暴露正文和内部错误', async () => {
  const f = await fixtures.fixture(); await f.service.onModuleInit();
  const result = await f.service.send('welcome', f.user.email, { username: '小高' });
  assert.equal(result.status, 'skipped'); assert.equal(f.service.timer, undefined);
  const receipt = (await f.service.outbox()).items[0];
  assert.equal(receipt.to, 'r***@qgauss.test'); assert.equal(receipt.status, 'skipped');
  for (const key of ['body', 'payload', 'error', 'dispatchToken', 'requestedById', 'requestKey']) assert.equal(Object.hasOwn(receipt, key), false);
  assert.deepEqual(await f.service.retryFailed(), { tried: 0, sent: 0, failed: 0 });
});

test('入队后立即返回，后台从模板重建双格式内容并保存接受回执', async () => {
  const f = await fixtures.fixture(); let release, captured;
  const held = new Promise(resolve => { release = resolve; });
  bind(f.service, async message => { captured = message; await held; return accepted(message); });
  const result = await f.service.send('welcome', f.user.email, { username: '<b>小高</b>' });
  assert.equal(result.status, 'queued');
  await mailSettles(f.prisma, result.id, ['sending']);
  while (!captured) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(captured.html, /&lt;b&gt;小高&lt;\/b&gt;/); assert.match(captured.text, /<b>小高<\/b>/);
  release(); const row = await mailSettles(f.prisma, result.id, ['sent']);
  assert.equal(row.attempts, 1); assert.ok(row.sentAt); assert.equal(row.error, null);
});

test('两个数据库连接与独立 worker 并发领取同一封邮件，只投递一次', async () => {
  const f = await fixtures.fixture(), row = await queued(f), other = fixtures.createService(f.secondClient(), f.settings);
  let sends = 0;
  for (const service of [f.service, other]) bind(service, async message => { sends++; await new Promise(resolve => setTimeout(resolve, 30)); return accepted(message); });
  const results = await Promise.all([f.service.dispatch(row.id), other.dispatch(row.id)]);
  assert.equal(results.filter(result => result.tried).length, 1); assert.equal(sends, 1);
  const saved = await f.prisma.mailOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(saved.status, 'sent'); assert.equal(saved.attempts, 1); assert.doesNotMatch(saved.body, /cached unsafe/);
});

test('明确临时拒绝有限重试，认证和永久拒绝及未知结果均不自动重发', async () => {
  const f = await fixtures.fixture(); let sends = 0;
  bind(f.service, async () => { sends++; throw Object.assign(Error('private SMTP message'), { responseCode: 451, command: 'RCPT TO' }); });
  const row = await queued(f); await f.service.dispatch(row.id);
  for (let index = 0; index < 2; index++) {
    await f.prisma.mailOutbox.update({ where: { id: row.id }, data: { lastTriedAt: new Date(0) } });
    assert.equal((await f.service.retryFailed()).tried, 1);
  }
  assert.equal((await f.service.retryFailed()).tried, 0); assert.equal(sends, 3);
  for (const error of [{ code: 'EAUTH', command: 'AUTH' }, { responseCode: 550, command: 'DATA' }, { code: 'ESOCKET', command: 'DATA' }]) {
    const next = await queued(f); bind(f.service, async () => { sends++; throw Object.assign(Error('secret provider context'), error); });
    await f.service.dispatch(next.id); await f.prisma.mailOutbox.update({ where: { id: next.id }, data: { lastTriedAt: new Date(0) } });
    assert.equal((await f.service.retryFailed()).tried, 0);
    const safe = (await f.service.outbox(1, 100)).items.find(item => item.id === next.id);
    assert.doesNotMatch(JSON.stringify(safe), /secret provider|private SMTP/);
  }
});

test('投递超时保留未知结果，不重新发送；同次投递的迟到接受回执可以归并', async () => {
  const f = await fixtures.fixture(); let release, sends = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.service.attemptDeadlineMs = 40;
  bind(f.service, async message => { sends++; await held; return accepted(message); });
  const row = await queued(f), task = f.service.dispatch(row.id);
  await mailSettles(f.prisma, row.id, ['unknown']); await task;
  assert.equal((await f.service.retryFailed()).tried, 0); assert.equal(sends, 1);
  release(); assert.equal((await mailSettles(f.prisma, row.id, ['sent'])).attempts, 1);
});

test('服务重启将遗留发送中记录转为未知，保留所有权且不补发', async () => {
  const f = await fixtures.fixture(); let sends = 0;
  const row = await queued(f, { status: 'sending', lastTriedAt: new Date(0), dispatchToken: 'private-owner' });
  bind(f.service, async message => { sends++; return accepted(message); });
  await f.service.retryFailed();
  const saved = await f.prisma.mailOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(saved.status, 'unknown'); assert.equal(saved.dispatchToken, 'private-owner'); assert.equal(sends, 0);
});

test('服务器接受后数据库写入失败，不得变成可重发的失败记录', async () => {
  const f = await fixtures.fixture(); let sends = 0;
  bind(f.service, async message => { sends++; return accepted(message); });
  const update = f.prisma.mailOutbox.updateMany.bind(f.prisma.mailOutbox);
  f.prisma.mailOutbox.updateMany = args => { if (args.data.status === 'sent') throw Error('synthetic persistence failure'); return update(args); };
  const row = await queued(f); assert.equal((await f.service.dispatch(row.id)).status, 'sending');
  f.prisma.mailOutbox.updateMany = update;
  await f.prisma.mailOutbox.update({ where: { id: row.id }, data: { lastTriedAt: new Date(0) } });
  await f.service.retryFailed(); assert.equal(sends, 1);
  assert.equal((await f.prisma.mailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status, 'unknown');
});

test('失效、已用、更换站点或不同账户的密码重置邮件在发送前被拦下', async () => {
  const f = await fixtures.fixture(); let sends = 0; bind(f.service, async message => { sends++; return accepted(message); });
  for (const scenario of ['expired', 'used', 'origin', 'recipient']) {
    const token = randomBytes(24).toString('hex');
    await f.prisma.passwordReset.create({ data: { userId: f.user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + (scenario === 'expired' ? -1000 : 60000)), usedAt: scenario === 'used' ? new Date() : null } });
    const resetUrl = (scenario === 'origin' ? 'https://old.qgauss.test' : 'https://qgauss.test') + '/reset-password?token=' + token;
    const row = await queued(f, { template: 'resetPassword', to: scenario === 'recipient' ? 'someone@qgauss.test' : f.user.email, payload: JSON.stringify({ resetUrl }) });
    assert.equal((await f.service.dispatch(row.id)).status, 'suppressed');
    assert.equal((await f.prisma.mailOutbox.findUniqueOrThrow({ where: { id: row.id } })).error, 'RESET_INACTIVE');
  }
  assert.equal(sends, 0);
});

test('未知模板、损坏变量及停用账户不会投递旧正文', async () => {
  const f = await fixtures.fixture(); let sends = 0; bind(f.service, async message => { sends++; return accepted(message); });
  for (const extra of [{ template: 'unknown' }, { payload: '{broken' }, { payload: '[]' }, { payload: 'null' }, { payload: '{"username":1}' }, { to: 'injected\r\n@qgauss.test' }]) {
    const row = await queued(f, extra); assert.equal((await f.service.dispatch(row.id)).status, 'suppressed');
  }
  await f.prisma.user.update({ where: { id: f.user.id }, data: { status: 'DISABLED' } });
  assert.equal((await f.service.dispatch((await queued(f)).id)).status, 'suppressed'); assert.equal(sends, 0);
});

test('队列并发数受限，积压邮件全部处理，销毁时关闭传输器', async () => {
  const f = await fixtures.fixture(); let active = 0, max = 0, closes = 0, started = 0, release, pairStarted;
  // Hold two deliveries open: database latency must not decide whether they overlap.
  const held = new Promise(resolve => { release = resolve; });
  const pair = new Promise(resolve => { pairStarted = resolve; });
  f.service.transporter = { async sendMail(message) { started++; active++; max = Math.max(max, active); if (active === 2) pairStarted(); await held; active--; return accepted(message); }, close() { closes++; } };
  const rows = []; for (let index = 0; index < 7; index++) rows.push(await queued(f));
  let timer;
  try {
    f.service.kick();
    await Promise.race([pair, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('two mail deliveries did not start')), 5000); })]);
    assert.equal(active, 2); assert.equal(started, 2);
    assert.equal(await f.prisma.mailOutbox.count({ where: { status: 'queued' } }), 5);
  } finally { clearTimeout(timer); release(); }
  await Promise.all(rows.map(row => mailSettles(f.prisma, row.id, ['sent'])));
  assert.equal(max, 2); f.service.onModuleDestroy(); assert.equal(closes, 1);
});

test('配置校验拒绝注入、无效端口、缺失认证和生产明文，正常设置不包含公开凭据', () => {
  const base = { MAIL_SMTP_HOST: 'smtp.qgauss.test', MAIL_FROM: 'QGauss AI <sender@qgauss.test>', NODE_ENV: 'production' };
  assert.equal(mailTransportConfiguration(base).ready, true);
  assert.equal(mailTransportConfiguration({ ...base, MAIL_RETRY_INTERVAL_MS: 'NaN' }).ready, false);
  assert.equal(mailTransportConfiguration({ ...base, MAIL_RETRY_INTERVAL_MS: '0' }).retryIntervalMs, 0);
  for (const extra of [{ MAIL_SMTP_HOST: 'https://smtp.qgauss.test' }, { MAIL_FROM: 'sender@qgauss.test\r\nBcc:x@qgauss.test' }, { MAIL_SMTP_PORT: '0' }, { MAIL_SMTP_USER: 'user' }, { MAIL_SMTP_SECURE: 'false', MAIL_SMTP_REQUIRE_TLS: 'false' }, { MAIL_CONNECTION_TIMEOUT_MS: 'Infinity' }, { MAIL_SMTP_SECURE: 'yes' }]) assert.equal(mailTransportConfiguration({ ...base, ...extra }).ready, false);
  assert.equal(maskedMailbox('bad\r\n@qgauss.test'), '收件地址已隐藏');
  assert.deepEqual(classifyMailFailure({ code: 'ESOCKET', command: 'CONN' }), { status: 'failed', code: 'SMTP_CONNECT' });
  assert.deepEqual(classifyMailFailure({ code: 'ESOCKET', command: 'DATA' }), { status: 'unknown', code: 'RESULT_UNKNOWN' });
});
