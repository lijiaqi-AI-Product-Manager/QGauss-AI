import {chatText as message} from '../i18n/chat-messages.js';
const literal=(original,values)=>message('zh',original,values);
const CAPABILITIES = { chat: '文字对话', vision: '图片理解', reasoning: '深度思考', tools: '工具调用', web_search:'联网检索', image: '图像创作', long: '长上下文' };
const CAP_SEARCH = { chat: '对话 聊天 文字 文字對話 對話 chat conversation text', vision: '视觉 识图 图片理解 視覺 識圖 圖片理解 image understanding vision', reasoning: '推理 思考 深度思考 deep reasoning', tools: '工具 函数 调用 函數 呼叫 tool use function call', web_search:'联网 搜索 检索 来源 聯網 搜尋 檢索 資料 web search', image: '绘图 画图 图像生成 繪圖 畫圖 圖像創作 image creation generation', long: '长上下文 长文 長上下文 長文 long context' };
export const MODEL_POOLS = Object.freeze({ model3: '低价模型', model4: '高价模型', drawMj: '绘图', agent: '智能体' });
export function modelCaps(model) { const value = model?.capabilities; return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(value => String(value).trim()).filter(Boolean))]; }
export function capabilityLabel(capability, translate = literal) { return CAPABILITIES[capability] ? (typeof translate==='function'?translate:literal)(CAPABILITIES[capability]) : capability; }
export function modelVendor(model, translate = literal) { return String(model?.vendor || '').trim() || translate('其他'); }
export function imageOnly(model) { const caps = modelCaps(model); return caps.includes('image') && !caps.includes('chat'); }
export function modelEntry(model, translate = literal) { return imageOnly(model) ? { path: '/painting', label: translate('去创作'), kind: translate('图像创作') } : { path: '/chat', label: translate('开始对话'), kind: translate('文字对话') }; }
export function contextSize(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : 0; }
export function contextLabel(value, translate = literal) { const number=contextSize(value); return number ? number>=1000 ? number%1000 ? translate('约 {count}K',{count:Number((number/1000).toFixed(1))}) : Number((number/1000).toFixed(1))+'K' : String(number) : translate('未配置'); }
export function exactTokens(value, translate = literal, locale = 'zh-CN') { const number=contextSize(value); return number ? number.toLocaleString(locale)+' tokens' : translate('未配置'); }
export function microsLabel(value, translate = literal) { const number=Number(value); if(value==null||value===''||!Number.isSafeInteger(number)||number<0||number>2147483647)return translate('未配置'); return '¥'+(number/1000000).toFixed(6).replace(/\.?0+$/,''); }
export function parseMicros(value) { const text = String(value).trim(); if (!/^\d{1,7}(\.\d{1,6})?$/.test(text)) return null; const [whole, fraction = ''] = text.split('.'); const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); return micros <= 2147483647n ? Number(micros) : null; }
export function modelBilling(model, translate = literal) {
 if(model?.unavailable)return{title:translate('已不在当前列表中'),detail:translate('显示的是上次看到的配置，请刷新或选择其他模型。')};
 if(imageOnly(model))return{title:translate('创作台查看费用'),detail:translate('按画质与成功张数结算，开始创作前展示报价。')};
 const billing=model?.billing;
 if(billing?.mode==='count'&&MODEL_POOLS[billing.pool]&&Number.isSafeInteger(billing.amount)&&billing.amount>0)return{title:translate('{amount} 次 / 完成对话',{amount:billing.amount}),detail:translate('从「{pool}」次数池结算，按发送时的配置。',{pool:translate(MODEL_POOLS[billing.pool])})};
 if(billing?.mode==='none')return{title:translate('当前不扣次数'),detail:translate(billing.reason==='demo'?'当前站点为演示模式。':billing.reason==='commerce-disabled'?'当前站点未开启次数收费。':'此模型未配置有效的次数消耗。')};
 return{title:translate('费用待确认'),detail:translate('刷新模型信息，查看当前站点的次数设置。')};
}
export function matchesModel(model, query, capability = '', readyOnly = false, vendor = '') {
  if (readyOnly && !model.ready || vendor && modelVendor(model) !== vendor) return false;
  const caps = modelCaps(model);
  if (capability === 'chat' ? imageOnly(model) : capability === 'long' ? contextSize(model.maxContext) < 128000 && !caps.includes('long') : capability && !caps.includes(capability)) return false;
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  const searchCaps = contextSize(model.maxContext) >= 128000 ? [...caps, 'long'] : caps;
  const haystack = normalize([model.name, model.displayName, modelVendor(model), model.description, ...(model.tags || []), ...searchCaps, ...searchCaps.map(cap=>capabilityLabel(cap)), ...searchCaps.map(cap => CAP_SEARCH[cap] || '')].join(' '));
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}
