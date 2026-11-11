const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const timestamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const requestKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value);
const emailContact=value=>value===null||typeof value==='string';
const fail=message=>{throw Error(message);};

export function managementPayload(kind,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!timestamp(input.expectedUpdatedAt)||!requestKey(input.requestKey))fail('请重新读取用户资料');
  const payload={expectedUpdatedAt:input.expectedUpdatedAt,requestKey:input.requestKey};
  const allowed=kind==='metadata'?['expectedUpdatedAt','requestKey','adminNote','isDistribution']:['expectedUpdatedAt','requestKey','expectedRevision','scope','sessionId'];
  if(Object.keys(input).some(key=>!allowed.includes(key)))fail('操作内容不正确');
  if(kind==='metadata'){
    if(input.adminNote!==undefined){if(typeof input.adminNote!=='string'||input.adminNote.length>2000||input.adminNote.includes('\0'))fail('管理备注最多 2000 字');payload.adminNote=input.adminNote.replaceAll('\r\n','\n').trim();}
    if(input.isDistribution!==undefined){if(typeof input.isDistribution!=='boolean')fail('分销资格不正确');payload.isDistribution=input.isDistribution;}
    if(!Object.hasOwn(payload,'adminNote')&&!Object.hasOwn(payload,'isDistribution'))fail('请选择要更新的资料');
  }else{
    if(!['session','all','others'].includes(kind)||!revision(input.expectedRevision)||input.scope!==({session:'one',all:'all',others:'others'}[kind]))fail('请重新读取登录列表');
    payload.scope=input.scope;payload.expectedRevision=input.expectedRevision;
    if(kind==='session'){if(!identifier(input.sessionId))fail('请重新读取登录列表');payload.sessionId=input.sessionId;}
    else if(input.sessionId!==undefined)fail('操作内容不正确');
  }
  return Object.freeze(payload);
}

export function readManagementIntent(value,actorId){
  try{const item=typeof value==='string'?JSON.parse(value):value;if(!item||item.actorId!==actorId||!identifier(item.target?.id)||typeof item.target.username!=='string'||!emailContact(item.target.email)||!['uncertain','rejected'].includes(item.state))return null;const payload=managementPayload(item.kind,item.payload),result={actorId,state:item.state,kind:item.kind,target:{id:item.target.id,username:item.target.username,email:item.target.email},payload};
    if(item.kind==='metadata'){if(typeof item.before?.adminNote!=='string'||item.before.adminNote.length>2000||typeof item.before.isDistribution!=='boolean')return null;result.before={adminNote:item.before.adminNote,isDistribution:item.before.isDistribution};}
    else if(item.kind==='session'){if(typeof item.device?.label!=='string'||typeof item.device.ip!=='string')return null;result.device={label:item.device.label,ip:item.device.ip};}
    else{if(!Number.isSafeInteger(item.count)||item.count<0)return null;result.count=item.count;}
    return result;
  }catch{return null;}
}

export function managementReceipt(value,intent){
  if(!value||!identifier(value.id)||value.userId!==intent.target.id||value.target?.id!==intent.target.id||value.actor?.id!==intent.actorId||value.kind!==intent.kind||value.requestKey!==intent.payload.requestKey||!timestamp(value.createdAt)||typeof value.changed!=='boolean')return false;
  if(value.outcome==='NOT_APPLIED')return value.changed===false;
  if(value.outcome!=='APPLIED')return false;
  if(intent.kind==='metadata')return value.after&&timestamp(value.after.updatedAt)&&['adminNote','isDistribution'].every(key=>!Object.hasOwn(intent.payload,key)||value.after[key]===intent.payload[key]);
  return Number.isSafeInteger(value.endedCount)&&value.endedCount===(intent.kind==='session'?1:intent.count)&&value.changed===(value.endedCount>0)&&value.scope===intent.payload.scope&&(intent.kind!=='session'||value.sessionId===intent.payload.sessionId);
}

export function loginSessionPage(value,userId,page,pageSize=8){
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  if(!value||value.userId!==userId||value.user?.id!==userId||!timestamp(value.user.updatedAt)||typeof value.user.username!=='string'||!emailContact(value.user.email)||value.page!==page||value.pageSize!==pageSize||!timestamp(value.asOf)||!timestamp(value.readAt)||!revision(value.revision)||!revision(value.otherRevision)||!count(value.otherTotal)||!count(value.total)||!count(value.activeTotal)||value.activeTotal<value.total||value.otherTotal>value.activeTotal||!Array.isArray(value.items)||value.items.length>Math.min(pageSize,value.total)||value.items.some(row=>!identifier(row.id)||!revision(row.revision)||!timestamp(row.createdAt)||!timestamp(row.lastSeenAt)||!timestamp(row.expiresAt)||typeof row.isCurrent!=='boolean'||typeof row.userAgent!=='string'||typeof row.ip!=='string'))fail('登录列表暂未读取完整，请重试');
  if(value.items.length>Math.max(0,Math.min(pageSize,value.total-(page-1)*pageSize)))fail('登录列表暂未读取完整，请重试');return value;
}

export function deviceLabel(agent=''){
  const os=/iPhone|iPad|iPod/i.test(agent)?'iOS':/Android/i.test(agent)?'Android':/Windows/i.test(agent)?'Windows':/Macintosh|Mac OS/i.test(agent)?'macOS':/Linux/i.test(agent)?'Linux':'';
  const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/Chrome\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'';
  return [browser,os].filter(Boolean).join(' · ');
}
