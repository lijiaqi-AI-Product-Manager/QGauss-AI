/** Actual HTTP, routing, attachments, cancellation and settlement; provider protocols stay on loopback. */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
const apiRoot = process.env.E2E_API || 'http://127.0.0.1:9520/api', fake = new URL(process.env.E2E_FAKE || 'http://127.0.0.1:9899/v1').origin;
const tag = Date.now() + '-' + Math.random().toString(36).slice(2, 7), prisma = new PrismaClient();
let admin = '', token = '', userId = '', passed = 0;
const pending = new Map(), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition) { assert.ok(condition, name); passed++; console.log('  ✔ ' + name); }
async function api(path, method = 'GET', body, access = admin) {
  const res = await fetch(apiRoot + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const raw = await res.json(); return { status: res.status, data: raw.data ?? raw };
}
async function settings(values) { assert.equal((await api('/settings', 'PUT', { settings: Object.entries(values).map(([key, value]) => ({ key, value })) })).status, 200); }
async function stats() { return (await (await fetch(fake + '/native/stats')).json()); }
const descriptors = [
  { type: 'OPENAI', flavor: 'openai', input: 17, output: 7 },
  { type: 'OPENAI_RESPONSES', flavor: 'responses', input: 19, output: 11 },
  { type: 'ANTHROPIC', flavor: 'anthropic', input: 26, output: 13 },
  { type: 'GEMINI', flavor: 'gemini', input: 23, output: 12 },
];
async function setup(descriptor, mode = 'normal', extra = {}) {
  const name = 'native-' + descriptor.flavor + '-' + mode + '-' + tag;
  const channel = (await api('/models/channels', 'POST', { name, type: descriptor.type, baseUrl: fake + '/native/' + descriptor.flavor + (descriptor.type === 'GEMINI' ? '/v1beta' : '/v1'), apiKey: 'local-native-key', timeoutMs: 10000, ...extra })).data;
  assert.ok(channel.id);
  const model = (await api('/models', 'POST', { name, displayName: 'QGauss 原生协议验收', capabilities: 'chat,vision', maxContext: 16000, maxOutput: 128, countPool: 'model3', countCost: 2, priceInPerM: 1000000, priceOutPerM: 1000000 })).data;
  assert.ok(model.id); assert.equal((await api('/models/' + model.id + '/channels', 'POST', { channelId: channel.id, upstreamName: name })).status, 201);
  return { ...descriptor, channel, model, name };
}
function decode(wire) { return wire.split(/\r?\n\r?\n/).flatMap(block => { const data = block.match(/^data: (.+)/m)?.[1], event = block.match(/^event: (.+)/m)?.[1]; return data && event ? [{ event, data: JSON.parse(data) }] : []; }); }
async function start(fixture, extra = {}) {
  const response = await fetch(apiRoot + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ model: fixture.name, clientMsgId: 'native-request-' + Math.random(), messages: [{ role: 'user', content: '检查原生协议的回复与结算' }], ...extra }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true); const reader = response.body.getReader(), decoder = new TextDecoder(); let wire = '', meta;
  while (!meta) { const part = await reader.read(); if (part.done) throw new Error('No metadata'); wire += decoder.decode(part.value, { stream: true }); meta = decode(wire).find(x => x.event === 'meta')?.data; }
  pending.set(meta.messageId, reader);
  return { meta, finish: async () => { while (true) { const part = await reader.read(); if (part.done) break; wire += decoder.decode(part.value, { stream: true }); } pending.delete(meta.messageId); return decode(wire); } };
}
const balance = async () => (await api('/balance/query', 'GET', undefined, token)).data;
try {
  admin = (await api('/auth/login', 'POST', { account: process.env.E2E_ADMIN || 'admin', password: process.env.E2E_PASSWORD || 'admin123456' }, '')).data.accessToken; assert.ok(admin);
  await settings({ 'security.registerEnabled': true, 'security.registerInviteCode': '', 'security.captchaEnabled': false, 'security.loginRateLimit': 1000, 'security.chatRateLimit': 1000, 'demo.siteEnabled': false, 'commerce.enabled': true, 'quota.dailyTokens': 0, 'chat.maxConcurrentStreams': 4, 'chat.runDetachedTimeoutMs': 120000 });
  const email = 'native-' + tag + '@qgauss.test', password = 'native-test-123456';
  assert.equal((await api('/auth/register', 'POST', { email, username: 'qgnative' + Math.random().toString(36).slice(2, 11), password }, '')).status, 201);
  const signed = (await api('/auth/login', 'POST', { account: email, password }, '')).data; token = signed.accessToken; userId = signed.user.id;
  await api('/balance/upgradeBalance', 'POST', { userId, model3Count: 100 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'QGauss-native-test.png');
  const uploaded = await fetch(apiRoot + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form }); const upload = (await uploaded.json()).data; assert.ok(upload.id);

  console.log('[protocols] native requests, attachments, usage and billing');
  for (const descriptor of descriptors) {
    const f = await setup(descriptor), before = await balance();
    const probe = (await api('/models/channels/' + f.channel.id + '/test', 'POST')).data;
    check(f.type + ' 后台测试使用原生接口', probe.ok === true);
    const request = await start(f, { temperature: 0.2, maxTokens: 64, messages: [{ role: 'system', content: 'QGauss 合成系统提示' }, { role: 'user', content: '查看本轮图片', attachments: [upload.id] }] });
    const packets = await request.finish(), done = packets.findLast(x => x.event === 'done')?.data;
    check(f.type + ' 流式中文与最终状态正确', done?.status === 'COMPLETED' && packets.filter(x => x.event === 'delta').map(x => x.data.v).join('') === '原生协议的中文回复🚀');
    check(f.type + ' 返回报送用量并保留来源', done.promptTokens === f.input && done.completionTokens === f.output && done.usageEstimated === false);
    const record = await prisma.usageRecord.findUnique({ where: { messageId: request.meta.messageId } });
    check(f.type + ' 消息、用量与成本参考一致保存', record?.promptTokens === f.input && record.completionTokens === f.output && record.estimated === false && record.costMicros === f.input + f.output);
    const after = await balance();
    check(f.type + ' 结算只扣一次，预留归零', after.counts.model3 === before.counts.model3 - 2 && after.reserved.model3 === 0 && done.charged.amount === 2);
    const observation = (await stats()).requests.filter(x => x.model === f.name).findLast(x => x.body.stream === true || x.path.includes('streamGenerateContent'));
    const image = f.type === 'GEMINI' ? observation.body.contents.at(-1).parts.find(x => x.inlineData)?.inlineData.data : f.type === 'ANTHROPIC' ? observation.body.messages.at(-1).content.find(x => x.type === 'image')?.source.data : f.type === 'OPENAI_RESPONSES' ? observation.body.input.at(-1).content.find(x => x.type === 'input_image')?.image_url.split(',')[1] : observation.body.messages.at(-1).content.find(x => x.type === 'image_url')?.image_url.url.split(',')[1];
    check(f.type + ' 本人上传的原始图片正确转换', image === png.toString('base64'));
    const detail = (await api('/conversations/' + request.meta.conversationId, 'GET', undefined, token)).data;
    const saved = detail.messages.find(x => x.id === request.meta.messageId);
    check(f.type + ' 历史保留用量来源并隐藏私有结算快照', saved.usageEstimated === false && saved.billing.charged === 2 && !('settlementJson' in saved));
    if (f.type !== 'OPENAI') check(f.type + ' 思考片段独立显示且不混入正文', packets.filter(x => x.event === 'reasoning').map(x => x.data.v).join('') === '公开思路');
  }

  console.log('[protocols] interruption, cancellation and limits');
  for (const descriptor of descriptors) {
    const cut = await setup(descriptor, 'cut'), before = await balance(), request = await start(cut); const packets = await request.finish();
    check(cut.type + ' 没有完成标记的中断回复明确失败', packets.findLast(x => x.event === 'done')?.data.status === 'FAILED');
    check(cut.type + ' 中断释放次数，保留已生成文字', (await balance()).counts.model3 === before.counts.model3 && (await prisma.message.findUnique({ where: { id: request.meta.messageId } })).content.includes('中文回复'));
    const hold = await setup(descriptor, 'hold'), held = await start(hold);
    for (let i = 0; i < 50 && !((await stats()).active[hold.name] > 0); i++) await pause(20);
    assert.ok((await stats()).active[hold.name] > 0);
    await api('/chat/runs/' + held.meta.messageId + '/cancel', 'POST', undefined, token); const stopped = await held.finish();
    for (let i = 0; i < 50 && (await stats()).active[hold.name]; i++) await pause(20);
    check(hold.type + ' 显式停止关闭实际连接并释放预留', stopped.findLast(x => x.event === 'done')?.data.status === 'ABORTED' && (await stats()).active[hold.name] === 0 && (await balance()).reserved.model3 === 0);
    const limited = await setup(descriptor, 'length'), limitRequest = await start(limited), limitedPackets = await limitRequest.finish();
    check(limited.type + ' 到输出上限明确标记 length，保存当次结果', limitedPackets.findLast(x => x.event === 'done')?.data.finishReason === 'length' && limitedPackets.findLast(x => x.event === 'done')?.data.status === 'COMPLETED');
  }
  const noUsage = await setup(descriptors[3], 'no-usage'), uncertain = await start(noUsage), uncertainPackets = await uncertain.finish();
  check('缺少用量时仍明确标为估算，不冒充服务方报送', uncertainPackets.findLast(x => x.event === 'done')?.data.usageEstimated === true && (await prisma.usageRecord.findUnique({ where: { messageId: uncertain.meta.messageId } })).estimated === true);
  const tool = await setup(descriptors[1], 'tools'), beforeTool = await balance(), toolRequest = await start(tool), toolPackets = await toolRequest.finish();
  check('未启用工具时明确失败并释放，不自动执行或发新请求', toolPackets.findLast(x => x.event === 'done')?.data.status === 'FAILED' && (await balance()).counts.model3 === beforeTool.counts.model3 && (await stats()).requests.filter(x => x.model === tool.name).length === 1);
  const broken = await setup(descriptors[0], 'bad-json'), brokenRequest = await start(broken), brokenPackets = await brokenRequest.finish();
  check('非法流数据不生成空白成功回复', brokenPackets.findLast(x => x.event === 'done')?.data.status === 'FAILED');

  console.log('[protocols] cross-protocol fallback and native key pool');
  const fallback = await setup(descriptors[1], 'pre-error'); const alternate = await setup(descriptors[2], 'fallback');
  await api('/models/channels/' + alternate.channel.id, 'PATCH', { priority: 1 });
  await api('/models/' + fallback.model.id + '/channels', 'POST', { channelId: alternate.channel.id, upstreamName: alternate.name });
  const switched = await start(fallback), switchPackets = await switched.finish();
  check('首字前失败可切换另一原生协议且只交付一份回复', switchPackets.findLast(x => x.event === 'done')?.data.status === 'COMPLETED' && switchPackets.filter(x => x.event === 'delta').map(x => x.data.v).join('') === '原生协议的中文回复🚀');
  check('换路后的用量取成功供应方，次数只结算原模型一次', switchPackets.findLast(x => x.event === 'done')?.data.promptTokens === alternate.input && switchPackets.findLast(x => x.event === 'done')?.data.charged.amount === 2);
  const pool = await setup(descriptors[2], 'pool', { apiKey: 'local-native-main-bad' });
  await api('/models/channels/' + pool.channel.id + '/keys', 'POST', { keys: ['local-native-pool-good'] });
  const poolRequest = await start(pool), poolPackets = await poolRequest.finish();
  check('原生协议换用 Key 池密钥，仍保留对应认证头', poolPackets.findLast(x => x.event === 'done')?.data.status === 'COMPLETED' && (await stats()).requests.findLast(x => x.model === pool.name).auth.anthropic === 'local-native-pool-good');
  const unbound = (await api('/models/channels', 'POST', { name: 'native-unbound-' + tag, type: 'GEMINI', baseUrl: fake + '/native/gemini/v1beta', apiKey: 'local-native-key' })).data;
  check('未绑定模型的原生渠道不猜测探测模型', (await api('/models/channels/' + unbound.id + '/test', 'POST')).data.error.includes('先为此渠道绑定'));
  for (const mode of ['probe-error', 'probe-html']) {
    const wrong = await setup(descriptors[1], mode); const result = (await api('/models/channels/' + wrong.channel.id + '/test', 'POST')).data;
    check(mode + ' 返回 HTTP 200 也不会被误判为连通成功', result.ok === false && result.status === 200 && !!result.error);
  }
  const wrongMock = await setup(descriptors[2], 'wrong-mock', { baseUrl: 'mock://invalid-native' });
  const wrongMockResult = (await api('/models/channels/' + wrongMock.channel.id + '/test', 'POST')).data;
  check('原生渠道填入模拟地址不能冒充本地模拟测试成功', wrongMockResult.ok === false && !wrongMockResult.note && !!wrongMockResult.error);
} finally {
  for (const [id, reader] of pending) { await api('/chat/runs/' + id + '/cancel', 'POST', undefined, token).catch(() => {}); await reader.cancel().catch(() => {}); }
  await prisma.$disconnect();
  if (admin) await settings({ 'commerce.enabled': false, 'security.loginRateLimit': 10, 'chat.maxConcurrentStreams': 2 }).catch(() => {});
}
console.log('\n原生协议回归：' + passed + ' 通过 / 0 失败');
