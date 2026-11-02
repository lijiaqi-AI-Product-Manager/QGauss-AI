import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateContext, estimateTokens } from '../dist/common/llm/context.js';

const msg = (role, content) => ({ role, content });

test('空输入返回空', () => {
  assert.deepEqual(truncateContext([], { maxContext: 100, maxOutput: 10 }), []);
});

test('预算充足时原样保留', () => {
  const input = [msg('system', 'sys'), msg('user', 'hello'), msg('assistant', 'hi')];
  const out = truncateContext(input, { maxContext: 8000, maxOutput: 100 });
  assert.deepEqual(out, input);
});

test('system 永远保留，旧消息被丢弃', () => {
  const input = [
    msg('system', '你是助手'),
    msg('user', 'a'.repeat(4000)),
    msg('assistant', 'b'.repeat(4000)),
    msg('user', '最后一句'),
  ];
  const out = truncateContext(input, { maxContext: 2000, maxOutput: 200 });
  assert.equal(out[0].role, 'system');
  assert.equal(out[out.length - 1].content, '最后一句');
  assert.ok(out.length < input.length);
});

test('保持原始时间顺序', () => {
  const input = [
    msg('user', 'one'),
    msg('assistant', 'two'),
    msg('user', 'three'),
  ];
  const out = truncateContext(input, { maxContext: 8000, maxOutput: 10 });
  assert.deepEqual(
    out.map((m) => m.content),
    ['one', 'two', 'three'],
  );
});

test('单条超长消息会被截断而不是丢光', () => {
  const long = 'x'.repeat(20000);
  const out = truncateContext([msg('user', long)], { maxContext: 1000, maxOutput: 100 });
  assert.equal(out.length, 1);
  assert.ok(out[0].content.length < long.length);
  assert.ok(out[0].content.length > 0);
});

test('token 估算：中文按 1 字 ≈ 1 token，英文 4 字符 ≈ 1', () => {
  assert.ok(estimateTokens('你好世界') >= 3);
  assert.ok(estimateTokens('hello world') <= 5);
  assert.equal(estimateTokens(''), 0);
});

test('超出预算时总 token 不超过 maxContext - maxOutput', () => {
  const input = [];
  for (let i = 0; i < 50; i += 1) {
    input.push(msg(i % 2 ? 'assistant' : 'user', '这是一段用来撑爆上下文的中文内容'.repeat(10)));
  }
  const maxContext = 4000;
  const maxOutput = 500;
  const out = truncateContext(input, { maxContext, maxOutput });
  const total = out.reduce((s, m) => s + estimateTokens(m.content), 0);
  assert.ok(total <= maxContext - maxOutput, `实际 ${total}`);
});

test('带图消息：截断时保留图片，且图片计入预算', () => {
  const img = 'data:image/png;base64,AAAA';
  const input = [
    msg('user', 'x'.repeat(3000)),
    msg('assistant', 'y'.repeat(3000)),
    { role: 'user', content: '【附件：a.pdf】' + 'z'.repeat(6000) + '\n这张图是什么？', images: [img, img] },
  ];
  const out = truncateContext(input, { maxContext: 2400, maxOutput: 200 });
  const last = out[out.length - 1];
  assert.deepEqual(last.images, [img, img]);
  assert.ok(last.content.endsWith('这张图是什么？'), '保留尾部的用户问题');
  assert.equal(out.length, 1, '图片占掉预算后，更早的长消息被丢弃');
});
