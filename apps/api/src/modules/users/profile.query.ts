import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

export const PROFILE_SIGNATURE_LIMIT=300;
export type ProfileInput={displayName?:string;avatar?:string|null;signature?:string;expectedUpdatedAt?:string};
export function profileInput(input:ProfileInput):ProfileInput{
  const invalid=(message:string):never=>{throw new BusinessException(ErrorCode.PARAM_INVALID,message);};
  if(!input||typeof input!=='object'||Array.isArray(input))invalid('资料内容不正确');
  const result:ProfileInput={};
  if(input.displayName!==undefined){if(typeof input.displayName!=='string'||![...input.displayName.trim()].length||[...input.displayName.trim()].length>32)invalid('创作昵称需要 1–32 个字符');result.displayName=input.displayName.trim();}
  if(input.avatar!==undefined){if(input.avatar!==null&&(typeof input.avatar!=='string'||[...input.avatar].length>2048))invalid('头像内容不正确');result.avatar=input.avatar;}
  if(input.signature!==undefined){if(typeof input.signature!=='string'||input.signature.includes('\0')||[...input.signature].length>PROFILE_SIGNATURE_LIMIT)invalid('个人签名最多 300 个字符');result.signature=input.signature.replaceAll('\r\n','\n').trim();}
  if(input.expectedUpdatedAt!==undefined){const value=input.expectedUpdatedAt;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)invalid('请重新读取当前资料后保存');result.expectedUpdatedAt=value;}
  if(!['displayName','avatar','signature'].some(key=>Object.hasOwn(result,key)))invalid('请选择要更新的资料');
  return result;
}
