/** Real HTTP and real isolated SQLite; synthetic loopback sources, no external search or paid account. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
if (process.env.DATABASE_URL !== 'file:./e2e.db') throw new Error('Web-search HTTP suite requires the isolated e2e.db');
const prisma = new PrismaClient(), root = process.env.E2E_API, fake = new URL(process.env.E2E_FAKE).origin;
const tag = randomUUID(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)), pending = new Map();
let admin = '', token = '', passed = 0;
const values = { 'security.registerEnabled': true, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'security.registerRateLimit': 1000, 'security.loginRateLimit': 1000, 'security.chatRateLimit': 1000, 'demo.siteEnabled': false, 'commerce.enabled': true, 'quota.dailyTokens': 0, 'chat.maxConcurrentStreams': 4, 'chat.runDetachedTimeoutMs': 120000 };
const original = await prisma.globalConfig.findMany({ where: { key: { in: Object.keys(values) } } });
async function api(path, method = 'GET', body, access = admin) {
  const response = await fetch(root + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const json = await response.json(); return { status: response.status, data: json.data ?? json };
}
const settings = entries => api('/settings', 'PUT', { settings: Object.entries(entries).map(([key, value]) => ({ key, value })) });
function check(name, value) { assert.ok(value, name); passed++; console.log('  ✔ ' + name); }
const stats = async () => (await (await fetch(fake + '/native/stats')).json());
const balance = async () => (await api('/balance/query', 'GET', undefined, token)).data;
async function setup(type = 'OPENAI_RESPONSES', mode = 'normal', capabilities = 'chat,web_search', extra) {
  const flavor = type === 'ANTHROPIC' ? 'anthropic' : type === 'OPENAI_RESPONSES' ? 'responses' : 'openai', name = 'qgauss-web-' + mode + '-' + tag + '-' + Math.random().toString(36).slice(2, 6);
  const channel = (await api('/models/channels', 'POST', { name, type, baseUrl: fake + '/native/' + flavor + '/v1', apiKey: 'qgauss-synthetic-search-key', timeoutMs: 10000, ...(extra ? { extra } : {}) })).data;
  assert.ok(channel.id);
  const model = (await api('/models', 'POST', { name, displayName: 'QGauss 合成检索验收', capabilities, maxContext: 16000, maxOutput: 128, countPool: 'model3', countCost: 2 })).data;
  assert.ok(model.id); assert.equal((await api('/models/' + model.id + '/channels', 'POST', { channelId: channel.id, upstreamName: name })).status, 201);
  return { type, channel, model, name };
}
const decode = wire => wire.split(/\r?\n\r?\n/).flatMap(block => { const data = block.match(/^data: (.+)/m)?.[1], event = block.match(/^event: (.+)/m)?.[1]; return data && event ? [{ event, data: JSON.parse(data) }] : []; });
async function start(fixture, extra = {}) {
  const body = { model: fixture.name, clientMsgId: randomUUID(), webSearch: true, messages: [{ role: 'user', content: '只查找本轮问题的资料' }], ...extra };
  const response = await fetch(root + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true, await (response.ok ? Promise.resolve('') : response.text()));
  const reader = response.body.getReader(), decoder = new TextDecoder(); let wire = '', meta;
  async function read() { const part = await reader.read(); if (!part.done) wire += decoder.decode(part.value, { stream: true }); return part; }
  while (!meta) { if ((await read()).done) throw new Error('Missing search metadata'); meta = decode(wire).find(row => row.event === 'meta')?.data; }
  pending.set(meta.messageId, reader);
  return { meta, body, until: async event => { while (!decode(wire).some(row => row.event === event)) if ((await read()).done) throw new Error('Missing ' + event); return decode(wire); }, finish: async () => { while (!(await read()).done) {} pending.delete(meta.messageId); return decode(wire); } };
}
const done = packets => packets.findLast(row => row.event === 'done')?.data;
try {
  admin = (await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, '')).data.accessToken; assert.ok(admin);
  assert.equal((await settings(values)).status, 200);
  const email = 'search-' + tag + '@qgauss.test', password = 'qgauss-synthetic-search-123';
  assert.equal((await api('/auth/register', 'POST', { email, username: 'qgsearch' + tag.replaceAll('-', '').slice(0, 12), password }, '')).status, 201);
  const signed = (await api('/auth/login', 'POST', { account: email, password }, '')).data; token = signed.accessToken; assert.ok(token);
  await api('/balance/upgradeBalance', 'POST', { userId: signed.user.id, model3Count: 40 });
  const fixtures = [await setup(), await setup('ANTHROPIC'), await setup('CUSTOM', 'gateway', 'chat,web_search', {webSearchProtocol:'retrieval',unrelated:'preserved'})];
  const ordinary = await setup('OPENAI_RESPONSES', 'ordinary', 'chat'), unconfigured = await setup('CUSTOM', 'unconfigured');
  const available = (await api('/models/available', 'GET', undefined, token)).data;
  check('入口只开放已配置模型与支持渠道，普通和未配置网关均不可联网', fixtures.every(f => available.find(row => row.id === f.model.id)?.webSearchAvailable === true) && [ordinary, unconfigured].every(f => available.find(row => row.id === f.model.id)?.webSearchAvailable === false));
  const beforeInvalid = await prisma.message.count(), beforeBalance = await balance();
  for (const webSearch of ['true', 'false', 1, null]) check('非法开关 ' + JSON.stringify(webSearch) + ' 在请求入口被拒绝', (await api('/chat/completions', 'POST', { model: fixtures[0].name, webSearch, messages: [{ role: 'user', content: 'invalid' }] }, token)).status === 400);
  for (const f of [ordinary, unconfigured]) check(f.type + ' 不支持检索时拒绝，不能伪装成联网回答', (await api('/chat/completions', 'POST', { model: f.name, webSearch: true, messages: [{ role: 'user', content: 'unsupported' }] }, token)).status === 400);
  check('拒绝请求不创建消息、不预留或扣减次数', await prisma.message.count() === beforeInvalid && (await balance()).counts.model3 === beforeBalance.counts.model3 && (await balance()).reserved.model3 === 0);
  for (const f of fixtures) {
    const before = await balance(), request = await start(f, { messages: [{ role: 'system', content: 'QGauss 合成指令' }, { role: 'user', content: 'QGAUSS_PREVIOUS_PRIVATE_QUESTION' }, { role: 'assistant', content: 'QGAUSS_PREVIOUS_PRIVATE_ANSWER' }, { role: 'user', content: '只查找本轮问题的资料' }] }), packets = await request.finish(), result = done(packets);
    check(f.type + ' 搜索进度与来源正常返回，回复完成', result?.status === 'COMPLETED' && result.webSearch.status === 'complete' && packets.some(row => row.event === 'search'));
    check(f.type + ' 来源与原文引用完整且只包含安全公开字段', result.webSearch.sources.length === 1 && result.webSearch.citations.length === 1 && !/QGAUSS_PRIVATE_SEARCH|encrypted|javascript:/.test(JSON.stringify(result.webSearch)));
    const observation = (await stats()).requests.findLast(row => row.model === f.name), serialized = JSON.stringify(observation.body);
    check(f.type + ' 原生检索按需开启，过往问答不发送给本轮搜索', observation.body.tools.length === 1 && !/QGAUSS_PREVIOUS_PRIVATE/.test(serialized) && serialized.includes('只查找本轮问题'));
    const after = await balance(); check(f.type + ' 一次回答只扣配置次数，预留全部释放', result.charged.amount === 2 && after.counts.model3 === before.counts.model3 - 2 && after.reserved.model3 === 0);
    const history = (await api('/conversations/' + request.meta.conversationId, 'GET', undefined, token)).data, saved = history.messages.find(row => row.id === request.meta.messageId);
    const message = (await api('/conversations/' + request.meta.conversationId + '/messages/' + request.meta.messageId, 'GET', undefined, token)).data;
    check(f.type + ' 历史和单条恢复保留引用，不暴露数据库原始快照', JSON.stringify(saved.webSearch) === JSON.stringify(result.webSearch) && JSON.stringify(message.webSearch) === JSON.stringify(result.webSearch) && !('searchJson' in saved) && !('searchJson' in message));
    const reconnect = await fetch(root + '/chat/runs/' + request.meta.messageId + '/events', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) });
    const snapshot = decode(await reconnect.text()).findLast(row => row.event === 'snapshot')?.data;
    check(f.type + ' 断线重连直接读取原答和来源，不再次检索', snapshot?.webSearch.status === 'complete' && (await stats()).requests.filter(row => row.model === f.name).length === 1);
    const replay = await start(f, { ...request.body, conversationId: request.meta.conversationId }), replayPackets = await replay.finish();
    check(f.type + ' 重复发送同一请求幂等恢复，不重扣或重复搜索', done(replayPackets)?.messageId === request.meta.messageId && (await stats()).requests.filter(row => row.model === f.name).length === 1 && (await balance()).counts.model3 === after.counts.model3);
  }
  const noSources = await setup('OPENAI_RESPONSES', 'no-sources'), missing = await start(noSources), missingResult = done(await missing.finish());
  check('没有来源时如实显示缺口，不冒充检索成功', missingResult.status === 'COMPLETED' && missingResult.webSearch.status === 'no_sources' && missingResult.webSearch.sources.length === 0);
  const cut = await setup('OPENAI_RESPONSES', 'cut'), alternate = await setup('ANTHROPIC', 'fallback');
  await api('/models/channels/' + alternate.channel.id, 'PATCH', { priority: 1 });
  await api('/models/' + cut.model.id + '/channels', 'POST', { channelId: alternate.channel.id, upstreamName: alternate.name });
  const beforeCut = await balance(), interrupted = await start(cut), interruptedResult = done(await interrupted.finish());
  check('搜索已开始后断流明确失败，不能静默换路重复执行搜索', interruptedResult.status === 'FAILED' && interruptedResult.webSearch.status === 'failed' && (await stats()).requests.filter(row => [cut.name, alternate.name].includes(row.model)).length === 1);
  check('搜索失败退回预留额度且不留下空的成功回复', (await balance()).counts.model3 === beforeCut.counts.model3 && (await balance()).reserved.model3 === 0 && (await prisma.message.findUnique({ where: { id: interrupted.meta.messageId } })).status === 'FAILED');
  const hold = await setup('OPENAI_RESPONSES', 'hold'), beforeHold = await balance(), running = await start(hold);
  await running.until('search');
  assert.equal((await api('/chat/runs/' + running.meta.messageId + '/cancel', 'POST', undefined, token)).status, 200);
  const stopped = done(await running.finish());
  for (let i = 0; i < 50 && (await stats()).active[hold.name]; i++) await pause(20);
  check('搜索进行中取消会关闭实际连接，保留明确中断状态', stopped.status === 'ABORTED' && stopped.webSearch.status === 'interrupted' && (await stats()).active[hold.name] === 0);
  await api('/chat/runs/' + running.meta.messageId + '/cancel', 'POST', undefined, token);
  check('重复取消不重复退费，最终预留为零', (await balance()).counts.model3 === beforeHold.counts.model3 && (await balance()).reserved.model3 === 0);
  const plain = await start(fixtures[0], { webSearch: false }); const plainResult = done(await plain.finish());
  const last = (await stats()).requests.findLast(row => row.model === fixtures[0].name);
  check('同模型关闭联网后走普通回答，不带检索工具或旧来源', plainResult.status === 'COMPLETED' && !plainResult.webSearch && !last.body.tools);
} finally {
  for (const [id, reader] of pending) { await api('/chat/runs/' + id + '/cancel', 'POST', undefined, token).catch(() => {}); await reader.cancel().catch(() => {}); }
  if (admin) await settings(Object.fromEntries(original.map(row => [row.key, JSON.parse(row.value)]))).catch(() => {});
  await prisma.$disconnect();
}
console.log('\n联网检索 HTTP 回归：' + passed + ' 通过 / 0 失败');
