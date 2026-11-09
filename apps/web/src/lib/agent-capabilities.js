const text=(value,limit)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit):'';
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000?value:null;
const items=value=>(Array.isArray(value)?value:[]).slice(0,20).map(row=>({name:text(row?.name,100),description:text(row?.description,500)})).filter(row=>row.name);

export function agentCapabilities(agent){
 const value=agent?.capabilities||{},reported=value.coverage?.version===2?value.coverage:{};
 const groups=['tools','workflows','knowledge'].map(kind=>{
  const raw=value[kind],entries=items(raw),total=count(value.counts?.[kind]),valid=Array.isArray(raw)&&raw.length<=20&&raw.every(row=>text(row?.name,100)),known=reported[kind]===true&&valid&&total!==null&&Math.min(total,20)===entries.length,legacyCount=kind==='knowledge'?count(value.knowledgeCount):null;
  return{kind,items:entries,total:known?total:null,recorded:known?total:kind==='knowledge'&&legacyCount>0?legacyCount:entries.length||null,status:known?'reported':entries.length||legacyCount>0?'partial':'unknown',truncated:known&&total>entries.length};
 });
 return{model:text(value.model,100),groups,complete:groups.every(group=>group.status==='reported')};
}
export function agentPreparation(agent){
 if(agent?.ready!==true)return{ready:false,reason:agent?.availability==='demo'?'演示模式暂不连接':agent?.availability==='disabled'?'搭档暂时休息':'等待完成连接'};
 const billing=agent.billing,valid=billing?.mode==='none'||billing?.mode==='count'&&billing.pool==='agent'&&Number.isSafeInteger(billing.amount)&&billing.amount>0&&billing.amount<=1000000;
 if(!valid)return{ready:false,reason:'费用待确认'};
 if(typeof agent.offerRevision!=='string'||!/^[a-f0-9]{64}$/.test(agent.offerRevision))return{ready:false,reason:'搭档资料待核对'};
 return{ready:true,reason:''};
}
