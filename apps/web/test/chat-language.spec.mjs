import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_MESSAGES, chatText} from '../src/i18n/chat-messages.js';
import {chatAppFailure, chatBilling, chatUsage} from '../src/lib/chat-presentation.js';
import {capabilityLabel, contextLabel, exactTokens, matchesModel, microsLabel, modelBilling, modelEntry, modelVendor} from '../src/lib/model-presentation.js';
import {agentQuote} from '../src/lib/agent-presentation.js';

const text = language => (original, values) => chatText(language, original, values);
const receipt = changes => ({state: 'SETTLED', pool: 'model3', limit: 2, reserved: 0, charged: 2, returned: 0, expired: 0, ...changes});

test('应用资料失效使用接口状态识别，英文错误可拦下旧设定，普通繁忙或模型错误保留原含义', () => {
  assert.equal(chatAppFailure({code: 1001, status: 409, message: 'Invalid parameters'}), 'stale');
  assert.equal(chatAppFailure({code: 1002, status: 404, message: 'Not found'}), 'check-access');
  assert.equal(chatAppFailure({code: 409, status: 409, message: '应用设定已变化，请重新打开并核对'}), 'stale');
  for (const error of [{code: 6002, status: 409, message: 'Conversation is busy'}, {code: 4001, status: 404, message: 'Conversation not found'}, {code: 3001, status: 404, message: 'Model not found'}, {code: 1001, status: 400, message: 'Invalid parameters'}]) assert.equal(chatAppFailure(error), null);
});

test('聊天语言只替换界面文案，插入的用户标题、花括号和特殊字符保留原文', () => {
  const title = '费用待确认 {p0} $& <自定义标题>';
  assert.equal(chatText('en', '删除会话「{p0}」？删除后不可恢复。', {p0: title}), `Delete conversation “${title}”? This cannot be undone.`);
  assert.match(chatText('zh-TW', '删除分组「{p0}」？其中的会话会回到未分组，不会被删除。', {p0: title}), new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(chatText('en', '自己的正文 {other} $&'), '自己的正文 {other} $&');
  assert.equal(chatText('zh-TW', '自己的正文 {other} $&'), '自己的正文 {other} $&');
});

test('繁体和英文保留全部文案参数，单个模型、文件和会员次数正确显示单数', () => {
  const params = value => [...value.matchAll(/\{(\w+)\}/g)].map(row => row[1]).sort();
  for (const [original, languages] of Object.entries(CHAT_MESSAGES)) for (const value of languages) assert.deepEqual(params(value), params(original), original);
  assert.equal(chatText('en', '共 {p0} 个模型', {p0: 1}), '1 model');
  assert.equal(chatText('en', '个模型', {count: 1}), ' model');
  assert.equal(chatText('en', '个模型', {count: 2}), ' models');
  assert.match(chatText('en', '最多还能添加 {p0} 个文件，多出的已忽略', {p0: 1}), /1 more file\./);
  assert.equal(chatText('en', '{count} 次会员额度已到期', {count: 1}), '1 membership credit expired');
});

test('模型与协作次数沿用原值，缺失或无效报价不会显示为免费', () => {
  const model = Object.freeze({name: 'qgauss-test-model', capabilities: ['chat'], billing: Object.freeze({mode: 'count', pool: 'model4', amount: 1})});
  assert.equal(modelBilling(model).title, '1 次 / 完成对话');
  assert.equal(modelBilling(model, text('en')).title, '1 credit / completed chat');
  assert.match(modelBilling(model, text('zh-TW')).detail, /高價模型/);
  for (const amount of [undefined, null, -1, 0, '2', Infinity]) assert.equal(modelBilling({...model, billing: {mode: 'count', pool: 'model4', amount}}, text('en')).title, 'Cost needs confirmation');
  assert.equal(modelBilling({...model, billing: {mode: 'none', reason: 'commerce-disabled'}}, text('en')).title, 'No credits used now');
  assert.equal(agentQuote({billing: {mode: 'count', pool: 'agent', amount: 2}}, text('en')).label, '2 credits / completed chat');
  assert.equal(agentQuote({}, text('en')).label, 'Cost needs confirmation');
  assert.equal(model.name, 'qgauss-test-model');
});

test('技术标识和自定义厂商保留原文，数量、入口和成本参考不因语言变化而改写', () => {
  const translate = text('en'), model = {vendor: '费用待确认', capabilities: ['chat']};
  assert.equal(modelVendor(model, translate), '费用待确认');
  assert.equal(modelVendor({}, translate), 'Other');
  assert.equal(capabilityLabel('费用待确认', translate), '费用待确认');
  assert.equal(capabilityLabel('vision', translate), 'Image understanding');
  assert.equal(exactTokens(131072, translate), '131,072 tokens');
  assert.equal(contextLabel(131072, translate), 'About 131.1K');
  assert.equal(modelEntry({capabilities: ['image']}, translate).path, '/painting');
  for (const value of [null, undefined, '', -1, Infinity]) assert.equal(microsLabel(value, translate), 'Not configured');
  assert.equal(microsLabel(0, translate), '¥0');
  assert.equal(microsLabel(3, translate), '¥0.000003');
});

test('模型能力支持三种语言及全角搜索，匹配不修改模型名称、厂商或描述', () => {
  const model = Object.freeze({name: 'qgauss-vision', displayName: '费用待确认', vendor: '模型广场', description: '上下文开', ready: true, capabilities: Object.freeze(['chat', 'vision']), maxContext: 131072});
  const before = JSON.stringify(model);
  for (const query of ['Image understanding', '图片理解', '圖片理解', 'ＩＭＡＧＥ', 'long context', '長上下文', '费用待确认']) assert.equal(matchesModel(model, query), true, query);
  assert.equal(matchesModel(model, 'unknown capability'), false);
  assert.equal(JSON.stringify(model), before);
});

test('聊天回执分别呈现结算、释放与到期，原数据不变且未知记录不会冒充零扣费', () => {
  const billing = Object.freeze(receipt({state: 'RELEASED', charged: 0, returned: 1, expired: 1})), before = JSON.stringify(billing);
  assert.equal(chatBilling(billing, text('en')), 'No site credits used · Released 1 credit · 1 membership credit expired');
  assert.match(chatBilling(billing, text('zh-TW')), /已釋放 1 次.*1 次會員額度已到期/);
  assert.equal(chatBilling(receipt({state: 'RELEASED', charged: 1, returned: 1}), text('en')), 'Settled 1 credit · Basic models · Released 1 credit');
  for (const value of [null, {state: 'RELEASED', charged: 0}, receipt({returned: undefined}), receipt({expired: -1}), receipt({charged: '2'}), receipt({state: 'UNKNOWN'}), receipt({state: 'FREE'})]) assert.equal(chatBilling(value, text('en')), 'Credit receipt needs confirmation');
  assert.equal(chatBilling(receipt({state: 'FREE', limit: 0, charged: 0}), text('en')), 'No site credits used');
  assert.equal(chatBilling(receipt({state: 'RESERVED', reserved: 2, charged: 0}), text('en')), 'Reserved 2 credits · Basic models · settled after completion');
  assert.equal(JSON.stringify(billing), before);
});

test('用量区分模型报送和估算，明确零值可展示，缺失或溢出信息仍待确认', () => {
  assert.equal(chatUsage({promptTokens: 19, completionTokens: 11, usageEstimated: false}, text('en')), 'Usage 30 · Reported by the model service');
  assert.equal(chatUsage({promptTokens: 0, completionTokens: 0, contextLimit: 16000, usageEstimated: true}, text('en')), 'Context 0 / 16000 · Estimated');
  for (const value of [null, {}, {promptTokens: 1}, {promptTokens: '1', completionTokens: 2}, {promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 1}]) assert.equal(chatUsage(value, text('en')), 'Usage needs confirmation');
});
