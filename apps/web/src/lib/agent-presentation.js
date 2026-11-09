import {chatText as message} from '../i18n/chat-messages.js';
const literal=(original,values)=>message('zh',original,values);
const RUN_STATES = new Set(['waiting', 'running', 'completed', 'interrupted', 'failed']);
export function agentQuote(agent, translate = literal) {
 const billing=agent?.billing;
 if(billing?.mode==='none')return{label:translate('当前不扣次数'),detail:translate('按站点当前设置；发送时再次核对。')};
 if(billing?.mode==='count'&&billing.pool==='agent'&&Number.isSafeInteger(billing.amount)&&billing.amount>0)return{label:translate('{amount} 次 / 完成对话',{amount:billing.amount}),detail:translate('使用智能体次数；失败或取消释放预留，到期次数随有效期结束。')};
 return{label:translate('费用待确认'),detail:translate('读取最新设置后再开始。')};
}
export function agentAvailability(agent) {
  return agent?.ready === true ? '已就位' : agent?.availability === 'demo' ? '演示模式暂不连接' : agent?.availability === 'disabled' ? '暂时休息' : '等待完成连接';
}
const cleanText = (value, length) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length) : '';
const STEP_LABELS=Object.freeze({toolCall:'工具协作',workflowCall:'工作流协作',toolReturn:'工具返回',workflowReturn:'工作流返回'});
const ownedStepCode=step=>typeof step?.labelCode==='string'&&Object.hasOwn(STEP_LABELS,step.labelCode)&&STEP_LABELS[step.labelCode]===step.label&&step.labelCode.startsWith(step.kind==='workflow'?'workflow':'tool')?step.labelCode:null;
export function agentStepLabel(step,translate=literal){const code=ownedStepCode(step);return code?translate(STEP_LABELS[code]):cleanText(step?.label,100);}
export function agentRunReport(value) {
  if (!value || value.kind !== 'agent' || !RUN_STATES.has(value.status)) return null;
  const steps = (Array.isArray(value.steps)?value.steps:[]).slice(0,24).filter(step=>step&&['tool','workflow'].includes(step.kind)).map(step=>{const row={kind:step.kind,label:cleanText(step.label,100),state:step.state==='returned'?'returned':'requested'},code=ownedStepCode({...step,...row});return{...row,...(code?{labelCode:code}:{})};}).filter(step=>step.label);
  const suggestions = [...new Set((Array.isArray(value.suggestions)?value.suggestions:[]).map(text=>cleanText(text,400)).filter(Boolean))].slice(0,6);
  const cancellation = ['requested','accepted','unknown'].includes(value.cancellation) ? value.cancellation : null;
  const artifacts=[],seen=new Set();for(const row of Array.isArray(value.artifacts)?value.artifacts:[]){if(typeof row?.url!=='string'||row.url.length>2048||/[\u0000-\u0020\u007f]/.test(row.url))continue;try{const url=new URL(row.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||seen.has(url.href)||artifacts.length>=12)continue;seen.add(url.href);artifacts.push({url:url.href,title:cleanText(row.title,180)||url.hostname,kind:row.kind==='image'?'image':'file'});}catch{}}
  return {kind:'agent',status:value.status,context:value.context==='continued'?'continued':'fresh',steps,...(value.stepsTruncated===true||Array.isArray(value.steps)&&value.steps.length>24?{stepsTruncated:true}:{}),suggestions,artifacts,...(cancellation?{cancellation}:{})};
}
export function agentRunTitle(report) {
  return {waiting:'搭档正在准备',running:'搭档正在协作',completed:'这一轮，已经完成',interrupted:'这一轮已中断',failed:'这一轮未能完成'}[report?.status] || '';
}
