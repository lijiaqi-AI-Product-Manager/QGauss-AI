export const USER_FILTERS = Object.freeze({keyword:'',status:'',role:'',username:'',email:'',distribution:'',adminNote:'',from:'',to:''});
export const GRANT_FIELDS = Object.freeze(['model3Count','model4Count','drawMjCount','agentCount','days']);
export const emptyGrant = () => ({model3Count:0,model4Count:0,drawMjCount:0,agentCount:0,days:0,amountYuan:'',remark:''});
const id = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const emailContact=value=>value===null||typeof value==='string';
export function userSearch(filters) {
  const query={};
  for(const [key,value] of Object.entries(filters)){if(typeof value!=='string')throw Error('查询条件不正确');if(value.trim())query[key]=value.trim();}
  for(const key of ['from','to'])if(query[key]){
    const value=query[key];if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('日期不正确');
    const point=new Date(value+'T00:00:00');if(!Number.isFinite(point.getTime())||`${point.getFullYear()}-${String(point.getMonth()+1).padStart(2,'0')}-${String(point.getDate()).padStart(2,'0')}`!==value)throw Error('日期不正确');
    if(key==='to')point.setHours(23,59,59,999);query[key]=point.toISOString();
  }
  if(query.from&&query.to&&query.from>query.to)throw Error('开始时间不能晚于结束时间');return query;
}
export function userPage(data,page,pageSize) {
  if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0||data.page!==page||data.pageSize!==pageSize||!Number.isFinite(Date.parse(data.asOf))||data.items.length>Math.min(pageSize,data.total)||data.items.some(row=>!id(row.id)||typeof row.username!=='string'||!emailContact(row.email)||!['ACTIVE','DISABLED'].includes(row.status)||!['USER','ADMIN'].includes(row.role))||!Number.isSafeInteger(data.active)||data.active<0||data.active>data.total||!Number.isSafeInteger(data.admins)||data.admins<0||data.admins>data.total)throw Error('incomplete users');
  return data;
}
export function userDetail(data,expectedId){
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  if(!data||data.id!==expectedId||typeof data.username!=='string'||!emailContact(data.email)||!['ACTIVE','DISABLED'].includes(data.status)||!['USER','ADMIN'].includes(data.role)||!Number.isFinite(Date.parse(data.updatedAt))||!Number.isFinite(Date.parse(data.readAt))||!count(data.balanceCents)||typeof data.isMember!=='boolean'||!data.activity||!['grants','logins','conversations'].every(key=>count(data.activity[key]))||!data.counts||!['model3','model4','drawMj','agent'].every(key=>data.counts[key]&&['paid','member','reserved'].every(field=>count(data.counts[key][field]))))throw Error('incomplete detail');
  return data;
}
export function grantPayload(form,user) {
  if(!id(user?.id)||!Number.isFinite(Date.parse(user.updatedAt)))throw Error('请重新读取用户资料');
  const result={userId:user.id,expectedUpdatedAt:user.updatedAt};
  for(const key of GRANT_FIELDS){const value=form[key];if(!Number.isSafeInteger(value)||value<(key==='days'?-1:0)||value>(key==='days'?36500:1_000_000))throw Error('次数或会员天数不正确');result[key]=value;}
  const amount=String(form.amountYuan??'').trim();
  if(amount&&!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount))throw Error('余额格式不正确（最多两位小数）');
  if(amount)result.amountYuan=amount;
  const remark=String(form.remark??'').trim();if(remark.length>500)throw Error('备注最多 500 字');if(remark)result.remark=remark;
  if(!GRANT_FIELDS.some(key=>result[key])&&!(amount&&Number(amount)>0))throw Error('至少填写一项发放内容');return result;
}
export function grantCents(payload){const [whole,part='']=String(payload.amountYuan||'0').split('.');return Number(whole)*100+Number(part.padEnd(2,'0'));}
export function readGrant(value,actorId) {
  try{
    const item=typeof value==='string'?JSON.parse(value):value;
    if(!item||item.actorId!==actorId||!['uncertain','rejected'].includes(item.state)||!id(item.target?.id)||item.payload?.userId!==item.target.id||typeof item.payload.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(item.payload.requestKey))return null;
    const expected=grantPayload(item.payload,{id:item.target.id,updatedAt:item.payload.expectedUpdatedAt});
    if(Object.keys(item.payload).some(key=>!Object.hasOwn(expected,key)&&key!=='requestKey'))return null;
    return {actorId,state:item.state,target:{id:item.target.id,username:String(item.target.username||''),email:item.target.email===null?null:String(item.target.email||'')},payload:Object.freeze({...expected,requestKey:item.payload.requestKey})};
  }catch{return null;}
}
export function grantReceipt(receipt,payload) {
  return receipt&&receipt.userId===payload.userId&&receipt.rechargeType==='admin'&&typeof receipt.uid==='string'&&receipt.amountCents===grantCents(payload)&&GRANT_FIELDS.every(key=>receipt[key]===payload[key]);
}
