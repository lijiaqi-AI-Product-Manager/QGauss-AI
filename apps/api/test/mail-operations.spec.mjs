import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { mailFixtures } from './mail-fixture.mjs';
import { MailOperationsService } from '../dist/modules/mail/mail-operations.service.js';
import { MailOutboxQuery, MailProbeDto } from '../dist/modules/mail/mail.dto.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';
const fixtures = mailFixtures(); after(() => fixtures.close());
const rejects = status => error => error.getStatus?.() === status;
const enable = service => { service.transporter = { sendMail: async message => ({ accepted: [message.to] }), close() {} }; service.kick = () => {}; };

test('状态区分配置就绪和收信确认；模板只使用示意资料且没有可点击重置链接', async () => {
  const f = await fixtures.fixture(); const status = await f.operations.status(f.user.id);
  assert.equal(status.transport.canTest, false); assert.equal(status.recentProbe, null); assert.equal(status.operatorMailbox, 'r***@qgauss.test');
  assert.deepEqual(Object.keys(status.counts).sort(), ['failed','queued','sending','sent','skipped','suppressed','unknown']);
  const templates = f.operations.templates(); assert.equal(templates.length, 4);
  assert.ok(templates.every(item => !/<a\b|<script\b/i.test(item.html)));
  assert.doesNotMatch(JSON.stringify(templates), /recipient@/);
  await assert.rejects(() => f.operations.createProbe(f.user.id, randomUUID(), 'test'), rejects(503));
  assert.equal(await f.prisma.mailOutbox.count(), 0);
});

test('并发相同意图只创建一封，收件人固定为数据库中的当前管理员', async () => {
  const f = await fixtures.fixture(); enable(f.service); const other = new MailOperationsService(f.secondClient(), f.service, f.settings, new RateLimitService()), key = randomUUID();
  const [a, b] = await Promise.all([f.operations.createProbe(f.user.id, key, 'test'), other.createProbe(f.user.id, key, 'test')]);
  assert.equal(a.id, b.id); assert.equal(await f.prisma.mailOutbox.count(), 1);
  const row = await f.prisma.mailOutbox.findUniqueOrThrow({ where: { id: a.id } }); assert.equal(row.to, f.user.email); assert.equal(row.requestKey, key);
  assert.equal((await f.operations.probe(f.user.id, key)).id, a.id);
  await assert.rejects(() => f.operations.probe('other-account', key), rejects(404));
  f.service.transporter = null; assert.equal((await f.operations.createProbe(f.user.id, key, 'test')).id, a.id);
});

test('数据库中的限额跨独立服务实例生效，同次请求的确认不重复扣额', async () => {
  const f = await fixtures.fixture(); enable(f.service);
  const second = new MailOperationsService(f.secondClient(), f.service, f.settings, new RateLimitService());
  const intents = Array.from({ length: 5 }, () => randomUUID());
  const results = await Promise.allSettled(intents.map((key, index) => (index % 2 ? second : f.operations).createProbe(f.user.id, key, 'test')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.getStatus() === 429));
  assert.equal(await f.prisma.mailOutbox.count(), 3);
});

test('收信确认只能由发起人操作；确认未知回执不会伪造服务器已接受', async () => {
  const f = await fixtures.fixture(); enable(f.service); const probe = await f.operations.createProbe(f.user.id, randomUUID(), 'test');
  await assert.rejects(() => f.operations.confirm(f.user.id, probe.id), rejects(409));
  await f.prisma.mailOutbox.update({ where: { id: probe.id }, data: { status: 'unknown', error: 'RESULT_UNKNOWN' } });
  await assert.rejects(() => f.operations.confirm('other-account', probe.id), rejects(404));
  const a = await f.operations.confirm(f.user.id, probe.id), b = await f.operations.confirm(f.user.id, probe.id);
  assert.equal(a.status, 'unknown'); assert.equal(a.sentAt, null); assert.ok(a.confirmedAt); assert.equal(a.confirmedAt.getTime(), b.confirmedAt.getTime());
  assert.ok((await f.operations.status(f.user.id)).recentProbe.confirmedAt);
});

test('隐藏历史主题、正文、邮件变量、原始错误和所有权，筛选分页仍可用', async () => {
  const f = await fixtures.fixture();
  await f.prisma.mailOutbox.create({ data: { to: 'private-person@qgauss.test', subject: 'private subject', body: 'reset token private', payload: 'private payload', template: 'resetPassword', status: 'failed', error: 'provider private password', dispatchToken: 'private owner' } });
  const result = await f.service.outbox(1, 8, { template: 'resetPassword', keyword: 'private-person' });
  assert.equal(result.total, 1); assert.equal(result.items[0].to, 'p***@qgauss.test');
  assert.doesNotMatch(JSON.stringify(result), /private|provider|password|payload|dispatchToken/);
  assert.equal((await f.service.outbox(2, 8)).items.length, 0);
});

test('请求拒绝隐式类型、越界页码、重复查询值与未知筛选，忽略收件人覆盖字段', async () => {
  const pipe = new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true }, whitelist: true });
  const query = await pipe.transform({ page: '2', pageSize: '8', status: '', keyword: '  qgauss  ' }, { type: 'query', metatype: MailOutboxQuery });
  assert.equal(query.page, 2); assert.equal(query.keyword, 'qgauss');
  for (const value of [{ page: '1.2' }, { pageSize: '101' }, { page: ['1','2'] }, { status: 'bad' }, { keyword: 123 }, { template: ['welcome'] }, { keyword: 'x\nq' }]) await assert.rejects(() => pipe.transform(value, { type: 'query', metatype: MailOutboxQuery }), rejects(400));
  await assert.rejects(() => pipe.transform({ requestKey: 123 }, { type: 'body', metatype: MailProbeDto }), rejects(400));
  assert.equal(Object.hasOwn(await pipe.transform({ requestKey: randomUUID(), to: 'other@qgauss.test' }, { type: 'body', metatype: MailProbeDto }), 'to'), false);
});
