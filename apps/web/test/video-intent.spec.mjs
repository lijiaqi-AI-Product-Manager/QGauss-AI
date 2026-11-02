import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoIntent } from '../src/lib/video-intent.js';
const intent = { requestKey: 'qgauss-original-intent', quoteRevision: 'a'.repeat(64), payload: { presetId: 'native-1', mode: 'text', prompt: '保持同一个创意' } };
test('提交意图按账户隔离，读取和清理不会重写另一账户的未确认创意', () => {
  const rows = new Map(), storage = { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), removeItem: k => rows.delete(k) }, a = videoIntent('a', storage), b = videoIntent('b', storage);
  a.save(intent); assert.equal(b.read(), null); b.save({ ...intent, requestKey: 'qgauss-second-intent' }); a.clear(); assert.equal(a.read(), null); assert.equal(b.read().requestKey, 'qgauss-second-intent');
});
test('损坏或不完整的恢复数据不会发起费用确认；存储不可用不阻断页面', () => {
  for (const value of ['{', 'null', JSON.stringify({ ...intent, requestKey: '../wrong' }), JSON.stringify({ ...intent, quoteRevision: '' }), JSON.stringify({ ...intent, payload: { prompt: '残缺' } })]) assert.equal(videoIntent('a', { getItem: () => value }).read(), null);
  const blocked = videoIntent('a', { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); }, removeItem() { throw Error('blocked'); } }); assert.equal(blocked.read(), null); assert.doesNotThrow(() => blocked.save(intent)); assert.doesNotThrow(() => blocked.clear());
});
