import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, resumeChat, waitMessageSettled, setAccessToken, setRefreshHandler, ApiError } from '../src/api/client.js';

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; setAccessToken(''); setRefreshHandler(null); });
const frame = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const response = text => new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

test('断流后只 GET 同一任务，重复游标事件不重复追加', async () => {
  setAccessToken('token'); const calls = []; let text = '';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method });
    return calls.length === 1
      ? response(frame(1, 'meta', { messageId: 'm1', conversationId: 'c1' }) + frame(2, 'delta', { v: '前半' }))
      : response(frame(2, 'delta', { v: '前半' }) + frame(3, 'delta', { v: '后半' }) + frame(4, 'done', { status: 'COMPLETED' }));
  };
  const transport = streamChat({ messages: [] }, { onDelta: value => { text += value; } });
  assert.equal((await transport.finished).ended, 'done');
  assert.equal(text, '前半后半');
  assert.deepEqual(calls, [{ url: '/api/chat/completions', method: 'POST' }, { url: '/api/chat/runs/m1/events?after=2', method: 'GET' }]);
});

test('重开历史先用快照替换旧文本，再继续接收增量与思考', async () => {
  setAccessToken('token'); let text = '旧缓存', reasoning = '', done = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/chat/runs/m1/events'); assert.equal(init.method, 'GET');
    return response(frame(10, 'snapshot', { messageId: 'm1', status: 'STREAMING', content: '保存的', reasoning: '想法' }) + frame(11, 'delta', { v: '全文' }) + frame(12, 'done', { status: 'COMPLETED' }));
  };
  const transport = resumeChat('m1', { onSnapshot: row => { text = row.content; reasoning = row.reasoning; }, onDelta: value => { text += value; }, onDone: () => { done += 1; } });
  assert.equal((await transport.finished).ended, 'done'); assert.equal(text, '保存的全文'); assert.equal(reasoning, '想法'); assert.equal(done, 1);
});

test('HTTP 响应头返回前也能立即解除订阅', async () => {
  setAccessToken('token'); let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(new DOMException('aborted', 'AbortError'));
      else init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  };
  const transport = streamChat({ messages: [] }); transport.abort();
  assert.equal((await transport.finished).ended, 'aborted'); assert.ok(calls <= 1);
});

test('切换账号后旧流不再触发回调或以新账号续接', async () => {
  setAccessToken('old'); let streamController, calls = 0, text = '';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(new ReadableStream({ start(controller) { streamController = controller; } }));
  };
  const transport = resumeChat('private-message', { onDelta: value => { text += value; } });
  await new Promise(resolve => setTimeout(resolve, 10));
  setAccessToken('new'); streamController.enqueue(new TextEncoder().encode(frame(1, 'delta', { v: '旧账号内容' }))); streamController.close();
  assert.equal((await transport.finished).ended, 'aborted'); assert.equal(text, ''); assert.equal(calls, 1);
});

test('完成快照本身就是终态，不要求重新生成或额外 done 事件', async () => {
  setAccessToken('token'); let completed = 0, finalText = '';
  globalThis.fetch = async () => response(frame(0, 'snapshot', { messageId: 'm1', content: '完整结果', status: 'COMPLETED', charged: null }));
  const transport = resumeChat('m1', { onSnapshot: row => { finalText = row.content; }, onDone: () => { completed += 1; } });
  assert.equal((await transport.finished).ended, 'done'); assert.equal(finalText, '完整结果'); assert.equal(completed, 1);
});

test('恢复同一登录会话的过期令牌，不更换任务或重复创建请求', async () => {
  setAccessToken('expired'); let calls = 0;
  setRefreshHandler(async () => { setAccessToken('renewed'); return true; });
  globalThis.fetch = async (url, init) => {
    calls += 1; assert.equal(url, '/api/chat/runs/m1/events'); assert.equal(init.method, 'GET');
    if (calls === 1) return new Response('{}', { status: 401 });
    assert.equal(init.headers.Authorization, 'Bearer renewed'); return response(frame(1, 'done', { status: 'COMPLETED' }));
  };
  try { assert.equal((await resumeChat('m1', { isCurrent: () => true }).finished).ended, 'done'); assert.equal(calls, 2); }
  finally { setRefreshHandler(null); }
});

test('私有任务不存在或已删除时停止重连，不回退为新的生成请求', async () => {
  setAccessToken('token'); let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ message: '消息不存在' }), { status: 404 }); };
  await assert.rejects(resumeChat('missing').finished, error => error instanceof ApiError && error.status === 404);
  assert.equal(calls, 1);
});

test('退出视图会取消重连等待，不再发起后续请求', async () => {
  setAccessToken('token'); let calls = 0, transport;
  globalThis.fetch = async () => { calls += 1; return response(frame(1, 'meta', { messageId: 'm1' })); };
  transport = streamChat({}, { onConnection: state => { if (state === 'reconnecting') transport.abort(); } });
  assert.equal((await transport.finished).ended, 'aborted'); assert.equal(calls, 1);
});

test('保存结算快照不是完成，续接仍只读取同一任务并在原结果结算后结束', async () => {
  setAccessToken('token'); let calls = 0, completed = 0; const seen = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'GET'); calls++;
    return calls === 1 ? response(frame(4, 'snapshot', { messageId: 'm1', status: 'SETTLING', content: '完整但待结算', charged: null })) : response(frame(4, 'snapshot', { messageId: 'm1', status: 'COMPLETED', content: '完整但待结算', charged: { pool: 'model3', amount: 2 } }));
  };
  const transport = resumeChat('m1', { onSnapshot: data => seen.push(data.status), onDone: () => completed++ });
  assert.equal((await transport.finished).ended, 'done'); assert.equal(calls, 2); assert.equal(completed, 1); assert.deepEqual(seen, ['SETTLING', 'COMPLETED']);
});

test('落库轮询不会把保存结算中误当终态', async () => {
  setAccessToken('token'); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: { status: calls === 1 ? 'SETTLING' : 'COMPLETED' } })); };
  const result = await waitMessageSettled('c1', 'm1', { intervalMs: 1, timeoutMs: 1000 });
  assert.equal(result.status, 'COMPLETED'); assert.equal(calls, 2);
});
