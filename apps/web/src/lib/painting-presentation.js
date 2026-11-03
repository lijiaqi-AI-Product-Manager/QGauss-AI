import {paintingText as message} from '../i18n/painting-messages.js';

const literal=(original,values)=>message('zh',original,values);
const count=value=>Number.isSafeInteger(value)&&value>=0;

/** The displayed estimate and admission guard use the same checked unit price. */
export function paintingQuote(billing,quality,images){
  const unknown={known:false,unitCost:null,total:null};
  if(!billing||billing.ready===false||typeof billing.enabled!=='boolean'||!Number.isInteger(images)||images<1||images>4||!['auto','low','medium','high'].includes(quality))return unknown;
  if(billing.enabled===false)return{known:true,unitCost:0,total:0};
  if(!count(billing.costPerImage))return unknown;
  const factor=billing.qualityFactors?.[quality];
  if(!Number.isSafeInteger(factor)||factor<=0)return unknown;
  const unitCost=billing.costPerImage*factor,total=unitCost*images;
  if(!count(unitCost)||unitCost*4>2_147_483_647||!count(total))return unknown;
  return{known:true,unitCost,total};
}

export function paintingPriceChanged(error){
  return error?.status===409&&error.code===1001||/绘画费用已更新/.test(error?.message||'');
}

/** A complete receipt can show zero; absent data never becomes a free creation. */
export function paintingReceipt(billing,translate=literal){
  const unknown={state:'UNKNOWN',known:false,title:translate('费用回执待核对'),notes:[translate('费用信息尚不完整，请重新打开作品核对。')]};
  if(billing?.state==='LEGACY')return{state:'LEGACY',known:false,title:translate('历史费用记录'),notes:[translate('这件作品来自此前版本，费用以钱包中的实际流水为准。')]};
  if(!billing||!['FREE','RESERVED','SETTLING','SETTLED','RELEASED'].includes(billing.state)||['unitCost','reserved','charged','returned','expired'].some(key=>!count(billing[key])))return unknown;
  if(billing.state==='FREE'&&['unitCost','reserved','charged','returned','expired'].some(key=>billing[key]!==0))return unknown;
  const active=['RESERVED','SETTLING'].includes(billing.state),notes=[];
  const title=billing.state==='FREE'?translate('本次不扣次数'):active?translate('次数已预留'):billing.state==='RELEASED'&&billing.charged===0?translate('未扣次数，预留已结束'):translate('本次已结算');
  if(active)notes.push(translate('已预留 {count} 次，按实际成功张数结算。',{count:billing.reserved}));
  if(billing.returned>0)notes.push(translate('未使用的 {count} 次已释放回可用额度。',{count:billing.returned}));
  if(billing.state==='FREE')notes.push(translate('提交时为免费创作，本次不会补扣次数。'));
  if(billing.expired>0)notes.push(translate('{count} 次未使用的会员预留已失效，不计入新一天或新套餐。',{count:billing.expired}));
  return{state:billing.state,known:true,title,unitCost:billing.unitCost,charged:billing.charged,notes};
}

const ratioLabels={'1:1':'方形','3:4':'竖版','4:3':'横版','16:9':'宽屏','9:16':'长屏','2:3':'竖版海报','3:2':'横版海报','2:1':'横幅','21:9':'超宽'};
export function paintingRatioLabel(row,translate=literal){
  const label=row?.label||row?.scene||'';
  return ratioLabels[row?.key]===label?translate(label):label;
}

export function paintingEventLabel(event,translate=literal){
  const original=typeof event?.message==='string'?event.message:'';
  const known={QUEUED:['任务已进入队列'],RUNNING:['已开始生成'],SETTLING:['图片已生成，正在保存作品并完成结算'],CANCELED:['用户取消，未使用的预留次数已释放']};
  if(known[event?.status]?.includes(original))return translate(original);
  let match;
  if(event?.status==='QUEUED'&&(match=/^任务已进入队列，已预留 (\d+) 次$/.exec(original)))return translate('任务已进入队列，已预留 {count} 次',{count:match[1]});
  if(event?.status==='SUCCESS'&&(match=/^生成完成，共 (\d+) \/ (\d+) 张$/.exec(original)))return translate('生成完成，共 {count} / {requested} 张',{count:match[1],requested:match[2]});
  return original;
}
