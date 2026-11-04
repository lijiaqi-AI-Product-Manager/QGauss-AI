import {videoText as message} from '../i18n/video-messages.js';
import {videoPools} from './video-intent.js';
import {videoToolMode} from './video-tools.js';

const literal=(original,values)=>message('zh',original,values);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=2_147_483_647;
const pool=value=>Object.hasOwn(videoPools,value);

export function videoPoolLabel(value,amount,translate=literal){
  return translate(videoPools[value]||'次数',{count:amount});
}

/** A confirmation needs the actual accepted quote, including an explicit zero. */
export function videoQuoteReady(quote,payload){
  if(!quote||typeof quote.revision!=='string'||!/^[a-f0-9]{64}$/.test(quote.revision)||!count(quote.cost)||!pool(quote.pool))return false;
  if(quote.mode!==undefined&&(!['text','image','extend','reference','edit','upscale','lipsync'].includes(quote.mode)||payload?.mode&&quote.mode!==payload.mode))return false;
  if(quote.followsSource!==undefined&&typeof quote.followsSource!=='boolean')return false;
  if(quote.followsSource&&(!Number.isFinite(quote.seconds)||quote.seconds<=0||!Number.isFinite(quote.multiplier)||quote.multiplier<1))return false;
  return true;
}

export function videoEstimate(pricing,seconds,mode,translate=literal){
  if(videoToolMode(mode))return translate('素材、时长与处理选项会一起核对，确认后才预留次数');
  if(!pricing||!count(pricing.base)||!count(pricing.perSecond)||!pool(pricing.pool)||!Number.isFinite(seconds)||seconds<0||seconds===0&&pricing.perSecond>0)return translate('费用待核对，开机前会重新确认');
  const cost=pricing.base+Math.ceil(pricing.perSecond*seconds);
  return count(cost)?translate('预计 {count} {unit} · 开机前再次确认',{count:cost,unit:videoPoolLabel(pricing.pool,cost,translate)}):translate('费用待核对，开机前会重新确认');
}

export function videoReceipt(billing,translate=literal){
  const unknown={state:'UNKNOWN',known:false,title:translate('费用回执待核对'),notes:[translate('费用信息尚不完整，请重新打开作品核对。')]};
  if(!billing||!pool(billing.pool)||!['FREE','RESERVED','SETTLING','SETTLED','RELEASED'].includes(billing.state)||['reserved','charged','returned','expired'].some(key=>!count(billing[key]))||billing.limit!==undefined&&!count(billing.limit))return unknown;
  if(billing.state==='FREE'&&['reserved','charged','returned','expired','limit'].some(key=>billing[key]!==undefined&&billing[key]!==0))return unknown;
  const active=['RESERVED','SETTLING'].includes(billing.state),notes=[];
  const title=billing.state==='FREE'?translate('本次不扣次数'):active?translate('次数已预留'):billing.state==='RELEASED'&&billing.charged===0?translate('未扣次数，预留已结束'):translate('本次已结算');
  if(active)notes.push(translate('本次已预留 {count} 次，完成并保存后结算。',{count:billing.reserved}));
  if(billing.returned>0)notes.push(translate('未使用的 {count} 次已释放回可用额度。',{count:billing.returned}));
  if(billing.expired>0)notes.push(translate('{count} 次未使用的会员预留已失效，不计入新一天或新套餐。',{count:billing.expired}));
  if(billing.state==='FREE')notes.push(translate('提交时为免费创作，本次不会补扣次数。'));
  return{state:billing.state,known:true,active,title,pool:billing.pool,reserved:billing.reserved,charged:billing.charged,returned:billing.returned,expired:billing.expired,notes};
}

const taskMessages={
  QUEUED:['这一幕已进入片场队列','已确认开机，本次不扣次数'],
  SUBMITTING:['正在向原连接提交这一幕'],
  POLLING:['外部任务已受理，接下来只查询这一幕','外部任务编号已保存，重启后只续查原任务','原任务编号已找回，将继续查询','服务方正在排片，仍在等待原任务','镜头正在一点点成形','原连接授权暂未通过，等待管理员核对；不会重新提交生成','原任务暂未查询完成，将继续核对，不会重复开机'],
  SAVING:['这一幕已完成，正在保存成片','原任务已完成，开始私有保存成片','原任务已完成，成片保存暂未完成，将继续保存同一结果'],
  SETTLING:['成片已保存，正在完成结算','成片已保存，结算暂未完成；将只继续本次结算'],
  SUCCESS:['成片已保存，可以开映了','成片已保存并完成本次约定结算'],
  CANCELED:['已停止站内等待，未结算预留已释放；外部服务可能继续处理','服务方已确认取消排队；站内预留已处理','服务方已接收运行中取消信号，仍可能完成或产生外部费用；站内预留已处理','已停止站内等待；外部任务已运行或不支持取消，仍可能产生外部费用','外部取消结果未确认，没有自动重发取消；站内预留已处理'],
  FAILED:['已保存的成片文件不完整，未结算预留已释放','创作等待时间已到，未结算预留已释放'],
};
export function videoTaskMessage(row,translate=literal){
  const original=typeof row?.message==='string'?row.message:'';
  if(taskMessages[row?.status]?.includes(original))return translate(original);
  const match=row?.status==='QUEUED'&&/^已确认开机，预留 (\d+) 次$/.exec(original);
  return match?translate('已确认开机，预留 {count} 次',{count:match[1]}):original;
}
