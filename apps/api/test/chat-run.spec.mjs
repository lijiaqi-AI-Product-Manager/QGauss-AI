import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ChatRun } from '../dist/modules/chat/chat-run.js';

class ResponseProbe extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  wire = '';
  blockNext = false;
  setHeader() {}
  flushHeaders() {}
  write(wire) { this.wire += wire; const ok = !this.blockNext; this.blockNext = false; return ok; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
}
const create = (timeout = 10000, limits) => new ChatRun('u1', 'c1', 'm1', timeout, limits);
const packets = res => res.wire.trim().split('\n\n').filter(x => x.includes('data:')).map(block => ({
  id: Number(block.match(/^id: (\d+)/m)?.[1]), event: block.match(/^event: (.+)/m)?.[1],
  data: JSON.parse(block.match(/^data: (.+)/m)[1]),
}));

test('保存结算中的替换快照也更新后续订阅者和背压恢复状态', () => {
  const run = create();
  try {
    run.emit('meta', { messageId: 'm1' }); run.emit('delta', { v: '完整回复' });
    run.emit('snapshot', { content: '完整回复', reasoning: '思考', status: 'SETTLING', charged: null });
    const observer = new ResponseProbe(); run.subscribe(observer, null);
    assert.equal(packets(observer)[0].data.status, 'SETTLING'); assert.equal(packets(observer)[0].data.content, '完整回复'); assert.equal(packets(observer)[0].data.charged, null);
  } finally { run.finish(); }
});

test('断开订阅不取消生成；按游标续接只收到缺失事件', () => {
  const run = create();
  try {
    const first = new ResponseProbe(); run.subscribe(first, 0);
    run.emit('meta', { messageId: 'm1' }); run.emit('delta', { v: '前半' });
    first.destroy();
    assert.equal(run.signal.aborted, false);
    run.emit('delta', { v: '后半' });
    const second = new ResponseProbe(); run.subscribe(second, 2);
    assert.deepEqual(packets(second).map(p => [p.id, p.event, p.data.v]), [[3, 'delta', '后半']]);
    assert.equal(run.content, '前半后半');
  } finally { run.finish(); }
});

test('过期游标和新订阅用完整快照替换；思考过程不会丢失', () => {
  const run = create(10000, { events: 2, bytes: 10000, subscribers: 4 });
  try {
    run.emit('meta', { title: '继续写' }); run.emit('reasoning', { v: '思考' });
    for (const v of ['一', '二', '三']) run.emit('delta', { v });
    for (const cursor of [null, 0]) {
      const res = new ResponseProbe(); run.subscribe(res, cursor);
      const [snapshot] = packets(res);
      assert.equal(snapshot.event, 'snapshot'); assert.equal(snapshot.id, 5);
      assert.equal(snapshot.data.content, '一二三'); assert.equal(snapshot.data.reasoning, '思考');
      assert.equal(snapshot.data.title, '继续写');
    }
  } finally { run.finish(); }
});

test('取消立即中止信号，不再接收额外文本；结算开始后不再改写状态', () => {
  const run = create();
  try {
    run.emit('delta', { v: '保留部分' }); assert.equal(run.cancel(), true);
    assert.equal(run.signal.aborted, true); run.emit('delta', { v: '不应增加' });
    assert.equal(run.content, '保留部分'); assert.equal(run.cancelReason, 'user_cancel');
    run.seal(); assert.equal(run.cancel(), false);
  } finally { run.finish(); }
});

test('无人查看超时会取消；重新附着会清除旧超时', async () => {
  const run = create(25);
  try {
    const res = new ResponseProbe(); run.subscribe(res, 0);
    await delay(45); assert.equal(run.signal.aborted, false);
    res.destroy(); await delay(45);
    assert.equal(run.signal.aborted, true); assert.equal(run.cancelReason, 'detached_timeout');
  } finally { run.finish(); }
});

test('慢客户端按 drain 合并成快照，终态也能完整交付', () => {
  const run = create();
  const res = new ResponseProbe(); run.subscribe(res, 0);
  res.blockNext = true; run.emit('delta', { v: '一' });
  run.emit('delta', { v: '二' }); run.emit('reasoning', { v: '想法' });
  run.seal(); run.emit('done', { status: 'COMPLETED', charged: { pool: 'model3', amount: 1 } }); run.finish();
  assert.equal(res.writableEnded, false);
  res.emit('drain');
  const last = packets(res).at(-1);
  assert.equal(last.event, 'snapshot'); assert.equal(last.data.content, '一二');
  assert.equal(last.data.reasoning, '想法'); assert.equal(last.data.status, 'COMPLETED');
  assert.deepEqual(last.data.charged, { pool: 'model3', amount: 1 }); assert.equal(res.writableEnded, true);
  assert.equal(res.listenerCount('drain'), 0);
});

test('按字节限制缓冲，超大事件仍可通过快照恢复', () => {
  const run = create(10000, { events: 8, bytes: 100, subscribers: 4 });
  try {
    run.emit('delta', { v: '长'.repeat(500) });
    const res = new ResponseProbe(); run.subscribe(res, 0);
    assert.equal(packets(res)[0].event, 'snapshot');
    assert.equal(packets(res)[0].data.content, '长'.repeat(500));
  } finally { run.finish(); }
});

test('订阅上限只关闭最旧连接，仍保持生成任务和新连接', () => {
  const run = create(10000, { events: 8, bytes: 10000, subscribers: 2 });
  try {
    const a = new ResponseProbe(), b = new ResponseProbe(), c = new ResponseProbe();
    run.subscribe(a, 0); run.subscribe(b, 0); run.subscribe(c, 0);
    assert.equal(a.writableEnded, true); assert.equal(b.writableEnded, false);
    assert.equal(c.writableEnded, false); assert.equal(run.signal.aborted, false);
    run.emit('delta', { v: '继续' }); assert.match(c.wire, /继续/);
  } finally { run.finish(); }
});
