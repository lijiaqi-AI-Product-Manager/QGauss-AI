/** Real HTTP run lifecycle, authorization and billing; only the upstream is synthetic. */
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
const FAKE = process.env.E2E_FAKE ?? 'http://127.0.0.1:9899/v1';
const fakeOrigin = new URL(FAKE).origin;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let admin = '', owner = '', other = '', passed = 0, failed = 0;
const pending = new Set();
const modelIds = new Map();
function check(name, condition, detail = '') { console.log(`  ${condition ? '✔' : '✘'} ${name}${condition ? '' : ` ${detail}`}`); condition ? passed++ : failed++; }
async function json(path, method = 'GET', body, access = admin) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const raw = await res.json().catch(() => null);
  return { status: res.status, data: raw?.data ?? raw };
}
async function settings(values) {
  const result = await json('/settings', 'PUT', { settings: Object.entries(values).map(([key, value]) => ({ key, value })) });
  if (result.status !== 200) throw new Error(`settings: ${result.status}`);
}
function decode(wire) {
  return wire.split(/\r?\n\r?\n/).flatMap(block => {
    const data = block.match(/^data: (.+)/m)?.[1], event = block.match(/^event: (.+)/m)?.[1];
    return data && event ? [{ id: Number(block.match(/^id: (\d+)/m)?.[1]), event, data: JSON.parse(data) }] : [];
  });
}
async function start(model) {
  const abort = new AbortController();
  const response = await fetch(API + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner}` },
    body: JSON.stringify({ model, clientMsgId: `run-${suffix}-${Math.random()}`, messages: [{ role: 'user', content: '验证生成任务的生命周期' }] }),
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error(`start failed: ${response.status} ${await response.text()}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let wire = '', meta;
  while (!meta) {
    const { done, value } = await reader.read();
    if (done) throw new Error('run closed before metadata');
    wire += decoder.decode(value, { stream: true }); meta = decode(wire).find(x => x.event === 'meta')?.data;
  }
  pending.add(meta.messageId);
  return { meta, abort, async finish() {
    while (true) { const { done, value } = await reader.read(); if (done) break; wire += decoder.decode(value, { stream: true }); }
    pending.delete(meta.messageId); return decode(wire);
  } };
}
async function events(messageId, query = '', access = owner, headers = {}) {
  return fetch(API + '/chat/runs/' + messageId + '/events' + query, { headers: { Authorization: `Bearer ${access}`, ...headers }, signal: AbortSignal.timeout(15000) });
}
async function account(tag) {
  const email = `run-${tag}-${suffix}@example.com`, password = 'run-test-123456';
  const registered = await json('/auth/register', 'POST', { email, username: `qgr${tag}${Math.random().toString(36).slice(2, 12)}`, password }, '');
  if (registered.status !== 201) throw new Error(`register ${tag}: ${registered.status}`);
  const loggedIn = await json('/auth/login', 'POST', { account: email, password }, '');
  return loggedIn.data?.accessToken;
}
async function model(channelId, name, upstreamName, billable = false) {
  const created = await json('/models', 'POST', { name, displayName: name, maxContext: 32000, maxOutput: 1024 });
  if (!created.data?.id) throw new Error(`model: ${created.status}`);
  modelIds.set(name, created.data.id);
  const bound = await json(`/models/${created.data.id}/channels`, 'POST', { channelId, upstreamName });
  if (bound.status !== 201) throw new Error(`binding: ${bound.status}`);
  if (billable) await json(`/models/${created.data.id}`, 'PATCH', { countPool: 'model3', countCost: 1 });
  return name;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitRow(meta) {
  let row;
  for (let n = 0; n < 40; n++) {
    row = (await json(`/conversations/${meta.conversationId}/messages/${meta.messageId}`, 'GET', undefined, owner)).data;
    if (!['PENDING', 'STREAMING', 'SETTLING'].includes(row?.status)) return row;
    await sleep(100);
  }
  return row;
}

async function main() {
  const login = await json('/auth/login', 'POST', { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' }, '');
  admin = login.data?.accessToken;
  if (!admin) throw new Error(`admin login: ${login.status}`);
  await settings({ 'security.loginRateLimit': 1000, 'security.registerEnabled': true, 'security.captchaEnabled': false, 'security.registerInviteCode': '', 'security.chatRateLimit': 1000, 'demo.siteEnabled': false, 'chat.maxConcurrentStreams': 2, 'chat.runDetachedTimeoutMs': 120000, 'commerce.enabled': true });
  owner = await account('a'); other = await account('b');
  const channel = await json('/models/channels', 'POST', { name: `qgauss-run-channel-${suffix}`, type: 'OPENAI', baseUrl: FAKE, timeoutMs: 15000 });
  const slow = await model(channel.data.id, `qgauss-run-slow-${suffix}`, 'fake-slow');
  const hold = await model(channel.data.id, `qgauss-run-hold-${suffix}`, 'qgauss-run-hold');
  const paid = await model(channel.data.id, `qgauss-run-paid-${suffix}`, 'fake-slow', true);
  const paidHold = await model(channel.data.id, `qgauss-run-paid-hold-${suffix}`, 'qgauss-run-hold', true);

  console.log('[runs] disconnect, cursor replay and terminal snapshot');
  const first = await start(slow); first.abort.abort();
  const listing = await json('/conversations', 'GET', undefined, owner);
  check('断开后历史仍标记生成中', listing.data.find(x => x.id === first.meta.conversationId)?.activeMessageId === first.meta.messageId);
  const forbiddenRead = await events(first.meta.messageId, '', other); const forbiddenStop = await json(`/chat/runs/${first.meta.messageId}/cancel`, 'POST', undefined, other);
  check('其他用户不能订阅或停止任务', forbiddenRead.status === 404 && forbiddenStop.status === 404);
  check('非法断点拒绝', (await events(first.meta.messageId, '?after=-1')).status === 400 && (await events(first.meta.messageId, '?after=1.5')).status === 400);
  const resumed = await events(first.meta.messageId, '?after=0'); const replayed = decode(await resumed.text());
  const done = replayed.find(x => x.event === 'done')?.data;
  check('实时续接保持 SSE 与顺序游标', resumed.status === 200 && resumed.headers.get('content-type')?.includes('text/event-stream') && replayed.every((x, i) => i === 0 || x.id > replayed[i - 1].id));
  check('断开后完整生成成功', done?.status === 'COMPLETED');
  const text = replayed.filter(x => x.event === 'delta').map(x => x.data.v).join('');
  const saved = await waitRow(first.meta);
  check('续接文本与最终落库完全一致', text.length > 10 && saved.content === text && saved.status === 'COMPLETED');
  const recovered = decode(await (await events(first.meta.messageId, '', owner, { 'Last-Event-ID': '2' })).text());
  check('完成后从数据库快照恢复', recovered[0]?.event === 'snapshot' && recovered[0].data.content === text && recovered[0].data.status === 'COMPLETED');
  check('支持 Last-Event-ID', recovered[0]?.id === 2);
  const detail = await json('/conversations/' + first.meta.conversationId, 'GET', undefined, owner);
  check('续接没有新增消息', detail.data.messages.length === 2);
  pending.delete(first.meta.messageId);

  console.log('[runs] generation limit, independent observers and cancellation');
  await settings({ 'chat.maxConcurrentStreams': 1 });
  const active = await start(hold);
  const denied = await json('/chat/completions', 'POST', { model: slow, messages: [{ role: 'user', content: '不应并发生成' }] }, owner);
  check('后台任务仍占用生成并发名额', denied.status === 429);
  const observer = await events(active.meta.messageId); const observerText = observer.text();
  check('附着观察连接不占用生成名额', observer.status === 200);
  const stopped = await json(`/chat/runs/${active.meta.messageId}/cancel`, 'POST', undefined, owner);
  const originalEnd = await active.finish(), observerEnd = decode(await observerText);
  check('显式停止同时通知所有订阅者', stopped.status === 200 && stopped.data.cancelRequested && originalEnd.at(-1)?.data.status === 'ABORTED' && observerEnd.at(-1)?.data.status === 'ABORTED');
  const repeated = await json(`/chat/runs/${active.meta.messageId}/cancel`, 'POST', undefined, owner);
  check('重复停止幂等', repeated.data.cancelRequested === false && repeated.data.status === 'ABORTED');
  const fakeStats = await (await fetch(fakeOrigin + '/stats')).json();
  let upstreamActive = fakeStats.active['qgauss-run-hold'];
  for (let n = 0; upstreamActive && n < 20; n++) { await sleep(100); upstreamActive = (await (await fetch(fakeOrigin + '/stats')).json()).active['qgauss-run-hold']; }
  check('停止真实关闭了上游连接', upstreamActive === 0);
  const next = await start(hold); await json(`/chat/runs/${next.meta.messageId}/cancel`, 'POST', undefined, owner); await next.finish();
  check('停止后释放生成并发名额', (await waitRow(next.meta)).status === 'ABORTED');

  console.log('[runs] orphan timeout and deleting an active reply');
  await settings({ 'chat.runDetachedTimeoutMs': 1000 });
  const orphan = await start(hold); orphan.abort.abort();
  const orphanRow = await waitRow(orphan.meta);
  check('无人查看超时取消而非继续占用名额', orphanRow.status === 'ABORTED' && orphanRow.finishReason === 'detached_timeout', JSON.stringify({status:orphanRow.status,finishReason:orphanRow.finishReason})); pending.delete(orphan.meta.messageId);
  await settings({ 'chat.runDetachedTimeoutMs': 120000 });
  const removed = await start(hold);
  const deleted = await json(`/conversations/${removed.meta.conversationId}/messages/${removed.meta.messageId}`, 'DELETE', undefined, owner);
  const deletedEnd = await removed.finish();
  check('删除运行中的消息会取消上游', deleted.status === 200 && deletedEnd.at(-1)?.data.status === 'ABORTED');
  const deletedRead = await events(removed.meta.messageId);
  check('已删除任务不可重新订阅', deletedRead.status === 404);

  console.log('[runs] completion charged once; cancellation free');
  const profile = await json('/users/profile', 'GET', undefined, owner);
  await json('/balance/upgradeBalance', 'POST', { userId: profile.data.id, model3Count: 3 });
  const before = (await json('/balance/query', 'GET', undefined, owner)).data.counts.model3;
  const upstreamBefore = (await (await fetch(fakeOrigin + '/stats')).json()).requests['fake-slow'] || 0;
  const billing = await start(paid); billing.abort.abort();
  const billedReply = decode(await (await events(billing.meta.messageId, '?after=0')).text());
  check('后台完成仍按原模型扣一次', billedReply.at(-1)?.data.charged?.amount === 1 && (await json('/balance/query', 'GET', undefined, owner)).data.counts.model3 === before - 1);
  for (let i = 0; i < 3; i++) await (await events(billing.meta.messageId)).text();
  const upstreamAfter = (await (await fetch(fakeOrigin + '/stats')).json()).requests['fake-slow'] || 0;
  check('多次重订阅既不重复调用上游也不重复扣费', upstreamAfter === upstreamBefore + 1 && (await json('/balance/query', 'GET', undefined, owner)).data.counts.model3 === before - 1); pending.delete(billing.meta.messageId);
  const canceled = await start(paidHold); await json(`/chat/runs/${canceled.meta.messageId}/cancel`, 'POST', undefined, owner); await canceled.finish();
  check('显式取消保留已有内容且不扣次数', (await waitRow(canceled.meta)).status === 'ABORTED' && (await json('/balance/query', 'GET', undefined, owner)).data.counts.model3 === before - 1);

  console.log('[runs] count reservations, competing admissions and clearing');
  await settings({ 'chat.maxConcurrentStreams': 3 });
  const remaining = (await json('/balance/query', 'GET', undefined, owner)).data.counts.model3;
  await json('/models/' + modelIds.get(paidHold), 'PATCH', { countCost: remaining });
  const requestsBefore = (await (await fetch(fakeOrigin + '/stats')).json()).requests['qgauss-run-hold'] || 0;
  const competitors = await Promise.allSettled([start(paidHold), start(paidHold)]);
  const winner = competitors.find(x => x.status === 'fulfilled')?.value;
  check('只够一轮时，并发对话只有一轮被接受', !!winner && competitors.filter(x => x.status === 'fulfilled').length === 1 && competitors.some(x => x.status === 'rejected' && x.reason.message.includes('402')));
  if (!winner) throw new Error('No reservation winner');
  const held = (await json('/balance/query', 'GET', undefined, owner)).data;
  check('接受时立即移出可用次数，预留不提前计入实际消耗', held.counts.model3 === 0 && held.reserved.model3 === remaining && winner.meta.billing?.reserved === remaining);
  for (let i = 0; i < 30 && ((await (await fetch(fakeOrigin + '/stats')).json()).requests['qgauss-run-hold'] || 0) === requestsBefore; i++) await sleep(50);
  const cleared = await json('/conversations/' + winner.meta.conversationId + '/messages', 'DELETE', undefined, owner); await winner.finish();
  const clearedView = (await json('/balance/query', 'GET', undefined, owner)).data;
  check('清空运行中的聊天后停止并释放，不遗留预留', cleared.status === 200 && clearedView.counts.model3 === remaining && clearedView.reserved.model3 === 0);
  check('清空后的聊天不再展示已删除内容', (await json('/conversations/' + winner.meta.conversationId, 'GET', undefined, owner)).data.messages.length === 0);
  const requestsAfter = (await (await fetch(fakeOrigin + '/stats')).json()).requests['qgauss-run-hold'] || 0;
  check('额度不足的竞争请求没有调用上游', requestsAfter === requestsBefore + 1);
  const lockedPrice = await start(paid);
  await json('/models/' + modelIds.get(paid), 'PATCH', { countCost: 7 }); await settings({ 'commerce.enabled': false });
  const priceResult = await lockedPrice.finish();
  check('生成中改价或关闭收费仍按接受时的一次结算', priceResult.at(-1)?.data.billing?.charged === 1 && (await json('/balance/query', 'GET', undefined, owner)).status === 404);
  await settings({ 'commerce.enabled': true });
  const finalView = (await json('/balance/query', 'GET', undefined, owner)).data;
  check('恢复商业化后，钱包与已完成回复的消耗一致', finalView.counts.model3 === remaining - 1 && finalView.reserved.model3 === 0);

  console.log(`\n生成任务回归：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error('生成任务验收失败：', error.message); process.exitCode = 1; }).finally(async () => {
  for (const messageId of pending) await json(`/chat/runs/${messageId}/cancel`, 'POST', undefined, owner).catch(() => {});
  if (admin) await settings({ 'commerce.enabled': false, 'chat.maxConcurrentStreams': 2, 'chat.runDetachedTimeoutMs': 120000, 'security.loginRateLimit': 10 }).catch(() => {});
});
