const CAPABILITIES = { chat: '文字对话', vision: '图片理解', reasoning: '深度思考', tools: '工具调用', web_search:'联网检索', image: '图像创作', long: '长上下文' };
const CAP_SEARCH = { chat: '对话 聊天 文字', vision: '视觉 识图 图片理解', reasoning: '推理 思考', tools: '工具 函数 调用', web_search:'联网 搜索 检索 来源 search web', image: '绘图 画图 图像生成', long: '长上下文 长文' };
export const MODEL_POOLS = Object.freeze({ model3: '低价模型', model4: '高价模型', drawMj: '绘图', agent: '智能体' });
export function modelCaps(model) { const value = model?.capabilities; return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(value => String(value).trim()).filter(Boolean))]; }
export function capabilityLabel(capability) { return CAPABILITIES[capability] || capability; }
export function modelVendor(model) { return String(model?.vendor || '').trim() || '其他'; }
export function imageOnly(model) { const caps = modelCaps(model); return caps.includes('image') && !caps.includes('chat'); }
export function modelEntry(model) { return imageOnly(model) ? { path: '/painting', label: '去创作', kind: '图像创作' } : { path: '/chat', label: '开始对话', kind: '文字对话' }; }
export function contextSize(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : 0; }
export function contextLabel(value) { const number = contextSize(value); return number ? number >= 1000 ? (number % 1000 ? '约 ' : '') + Number((number / 1000).toFixed(1)) + 'K' : String(number) : '未配置'; }
export function exactTokens(value) { const number = contextSize(value); return number ? number.toLocaleString('zh-CN') + ' tokens' : '未配置'; }
export function microsLabel(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0 || number > 2147483647) return '未配置'; return '¥' + (number / 1000000).toFixed(6).replace(/\.?0+$/, ''); }
export function parseMicros(value) { const text = String(value).trim(); if (!/^\d{1,7}(\.\d{1,6})?$/.test(text)) return null; const [whole, fraction = ''] = text.split('.'); const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); return micros <= 2147483647n ? Number(micros) : null; }
export function modelBilling(model) {
  if (model?.unavailable) return { title: '已不在当前列表中', detail: '显示的是上次看到的配置，请刷新或选择其他模型。' };
  if (imageOnly(model)) return { title: '创作台查看费用', detail: '按画质与成功张数结算，开始创作前展示报价。' };
  const billing = model?.billing;
  if (billing?.mode === 'count' && MODEL_POOLS[billing.pool] && Number.isSafeInteger(billing.amount) && billing.amount > 0) return { title: billing.amount + ' 次 / 完成对话', detail: '从「' + MODEL_POOLS[billing.pool] + '」次数池结算，按发送时的配置。' };
  if (billing?.mode === 'none') return { title: '当前不扣次数', detail: billing.reason === 'demo' ? '当前站点为演示模式。' : billing.reason === 'commerce-disabled' ? '当前站点未开启次数收费。' : '此模型未配置有效的次数消耗。' };
  return { title: '费用待确认', detail: '刷新模型信息，查看当前站点的次数设置。' };
}
export function matchesModel(model, query, capability = '', readyOnly = false, vendor = '') {
  if (readyOnly && !model.ready || vendor && modelVendor(model) !== vendor) return false;
  const caps = modelCaps(model);
  if (capability === 'chat' ? imageOnly(model) : capability === 'long' ? contextSize(model.maxContext) < 128000 && !caps.includes('long') : capability && !caps.includes(capability)) return false;
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
  const searchCaps = contextSize(model.maxContext) >= 128000 ? [...caps, 'long'] : caps;
  const haystack = normalize([model.name, model.displayName, modelVendor(model), model.description, ...(model.tags || []), ...searchCaps, ...searchCaps.map(capabilityLabel), ...searchCaps.map(cap => CAP_SEARCH[cap] || '')].join(' '));
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}
