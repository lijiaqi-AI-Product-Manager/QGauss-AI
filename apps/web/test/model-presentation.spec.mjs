import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextLabel, exactTokens, imageOnly, matchesModel, microsLabel, modelBilling, modelCaps, modelEntry, parseMicros } from '../src/lib/model-presentation.js';
test('micro-cost reference round-trips six decimals without truncation and rejects invalid or overflowing input', () => {
  for (const value of [0, 1, 3, 10, 1000000, 1200000, 2147483647]) assert.equal(parseMicros(microsLabel(value).slice(1)), value);
  assert.equal(microsLabel(3), '¥0.000003'); assert.equal(microsLabel(1200000), '¥1.2');
  for (const value of ['', '-1', '0.0000001', '2147.483648', 'Infinity', '1e3']) assert.equal(parseMicros(value), null);
  assert.equal(microsLabel(-1), '未配置'); assert.equal(microsLabel(undefined), '未配置');
});
test('model capabilities, exact limits and combined search preserve unknown identifiers and distinguish image creation', () => {
  const model = { name: 'qg-vision', displayName: 'AI 图像搭档', vendor: ' QGauss ', description: '视觉理解', capabilities: ['chat', ' vision ', 'vision', 'custom'], ready: true, maxContext: 131072 };
  assert.deepEqual(modelCaps(model), ['chat', 'vision', 'custom']); assert.equal(matchesModel(model, 'ＡＩ 视觉', 'vision', true, 'QGauss'), true);
  assert.equal(matchesModel(model, '', 'long'), true); assert.equal(matchesModel(model, '', 'image'), false);
  assert.equal(exactTokens(model.maxContext), '131,072 tokens'); assert.match(contextLabel(model.maxContext), /^约/);
  assert.equal(imageOnly({ capabilities: ['image', 'vision'] }), true); assert.equal(modelEntry({ capabilities: ['image'] }).path, '/painting');
  assert.equal(modelEntry({ capabilities: ['image', 'chat'] }).path, '/chat');
  assert.equal(matchesModel({ capabilities: ['reasoning'] }, '推理'), true);
});
test('effective billing distinguishes count rules, disabled commerce, unknown metadata and creation estimates from token cost references', () => {
  const model = { priceInPerM: 3000000, countPool: 'model4', countCost: 3 };
  assert.equal(modelBilling(model).title, '费用待确认');
  assert.equal(modelBilling({ ...model, billing: { mode: 'none', reason: 'commerce-disabled' } }).title, '当前不扣次数');
  assert.equal(modelBilling({ ...model, billing: { mode: 'count', pool: 'model4', amount: 3 } }).title, '3 次 / 完成对话');
  assert.equal(modelBilling({ ...model, capabilities: ['image'] }).title, '创作台查看费用');
  assert.equal(modelBilling({ ...model, unavailable: true }).title, '已不在当前列表中');
});
