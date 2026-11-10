import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {activityQuery} from './users.query';

const invalid=(message:string):never=>{throw new BusinessException(ErrorCode.PARAM_INVALID,message,400);};
function object(input:object,keys:string[]){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))invalid('操作内容不正确');return input as Record<string,unknown>;}
function base(value:Record<string,unknown>){const date=value.expectedUpdatedAt;if(typeof date!=='string'||date.length>40||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date)invalid('请使用重新读取的用户资料版本');if(typeof value.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(value.requestKey))invalid('操作编号不正确');return{expectedUpdatedAt:date as string,requestKey:value.requestKey as string};}
export function managementInput(input:object){const value=object(input,['expectedUpdatedAt','requestKey','adminNote','isDistribution']),result:{expectedUpdatedAt:string;requestKey:string;adminNote?:string;isDistribution?:boolean}=base(value);
  if(value.adminNote!==undefined){if(typeof value.adminNote!=='string'||value.adminNote.length>2000||value.adminNote.includes('\0'))invalid('管理备注最多 2000 字');result.adminNote=(value.adminNote as string).replaceAll('\r\n','\n').trim();}
  if(value.isDistribution!==undefined){if(typeof value.isDistribution!=='boolean')invalid('分销资格不正确');result.isDistribution=value.isDistribution as boolean;}
  if(!Object.hasOwn(result,'adminNote')&&!Object.hasOwn(result,'isDistribution'))invalid('请选择要更新的资料');return result;
}
export function sessionActionInput(input:object){const value=object(input,['expectedUpdatedAt','requestKey','scope','expectedRevision','sessionId']),result={...base(value),scope:value.scope as 'one'|'all'|'others',expectedRevision:value.expectedRevision as string,sessionId:value.sessionId as string|undefined};
  if(!['one','all','others'].includes(result.scope)||typeof result.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(result.expectedRevision))invalid('请重新读取登录列表');
  if(result.scope==='one'){if(typeof result.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(result.sessionId))invalid('登录编号不正确');}else if(value.sessionId!==undefined)invalid('操作内容不正确');
  return result;
}
export function sessionQuery(input:Record<string,unknown>={}){if(Object.keys(input).some(key=>!['page','pageSize','asOf'].includes(key)))invalid('不支持的登录查询条件');const {kind:_,...query}=activityQuery({...input,kind:'logins'});return query;}
