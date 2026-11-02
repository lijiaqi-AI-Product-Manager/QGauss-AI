import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser } from '../src/lib/sse-parser.js';

function collect() {
  const events = [];
  const parser = createSseParser((event, data) => events.push({ event, data }));
  return { events, parser };
}

test('解析单个完整事件', () => {
  const { events, parser } = collect();
  parser.push('event: delta\ndata: {"v":"你好"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'delta');
  assert.equal(events[0].data.v, '你好');
});

test('跨 chunk 拆包能正确拼接', () => {
  const { events, parser } = collect();
  parser.push('event: del');
  parser.push('ta\ndata: {"v":"a"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.v, 'a');
});

test('一次 push 多个事件', () => {
  const { events, parser } = collect();
  parser.push('event: delta\ndata: {"v":"1"}\n\nevent: delta\ndata: {"v":"2"}\n\n');
  assert.deepEqual(events.map((e) => e.data.v), ['1', '2']);
});

test('忽略心跳注释行', () => {
  const { events, parser } = collect();
  parser.push(': ping\n\n');
  assert.equal(events.length, 0);
});

test('兼容 CRLF 换行', () => {
  const { events, parser } = collect();
  parser.push('event: meta\r\ndata: {"conversationId":"x"}\r\n\r\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.conversationId, 'x');
});

test('多行 data 会拼接', () => {
  const { events, parser } = collect();
  parser.push('event: delta\ndata: line1\ndata: line2\n\n');
  assert.equal(events[0].data, 'line1\nline2');
});

test('flush 能吐出没有结尾空行的残留', () => {
  const { events, parser } = collect();
  parser.push('event: done\ndata: {"status":"COMPLETED"}');
  assert.equal(events.length, 0);
  parser.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].data.status, 'COMPLETED');
});

test('坏 JSON 不抛异常，保留原始字符串', () => {
  const { events, parser } = collect();
  parser.push('event: delta\ndata: {broken\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data, '{broken');
});
