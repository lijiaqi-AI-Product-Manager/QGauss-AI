import {createHash,timingSafeEqual} from 'node:crypto';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
export const externalBad=(message='这次连接暂未完成，请核对后再试。',status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
export const externalMissing=()=>new BusinessException(ErrorCode.NOT_FOUND,'未找到这次连接',404);
export const externalChanged=()=>externalBad('这次连接已有变化，请重新核对。',409);
export const externalHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function externalObject(value:unknown,allowed:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw externalBad();return value as Record<string,unknown>;}
export function externalKey(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw externalBad();return value;}
export function externalProof(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw externalMissing();return value;}
export function externalVersion(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<0)throw externalBad();return Number(value);}
export function externalMethod(value:unknown){if(value!=='qr'&&value!=='browser')throw externalBad();return value;}
export function externalEqual(a:string,b:string){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export function externalCreateInput(value:unknown,link:boolean){
 const body=externalObject(value,link?['method','expectedVersion','currentPassword']:['method','expectedVersion','agreed','inviteCode']),method=externalMethod(body.method);if(externalVersion(body.expectedVersion)!==0)throw externalChanged();
 if(link){if(typeof body.currentPassword!=='string'||!body.currentPassword||body.currentPassword.length>128||Buffer.byteLength(body.currentPassword)>512)throw externalBad('先填写当前密码，再准备身份关联。');return{method,currentPassword:body.currentPassword,inviteCode:'',agreed:false};}
 if(body.agreed!==true)throw externalBad('请先阅读并同意用户协议及隐私政策。');if(body.inviteCode!==undefined&&(typeof body.inviteCode!=='string'||body.inviteCode.length>64))throw externalBad();return{method,currentPassword:'',inviteCode:typeof body.inviteCode==='string'?body.inviteCode.trim():'',agreed:true};
}
export function externalFinishInput(value:unknown,link:boolean){const body=externalObject(value,link?['expectedVersion']:['expectedVersion','agreed']);if(!link&&body.agreed!==true)throw externalBad('请先阅读并同意用户协议及隐私政策。');return{expectedVersion:externalVersion(body.expectedVersion)};}
export function externalCloseInput(value:unknown){const body=externalObject(value,['expectedVersion','method']);return{expectedVersion:externalVersion(body.expectedVersion),method:externalMethod(body.method)};}
export function externalExchangeInput(value:unknown){return externalVersion(externalObject(value,['expectedVersion']).expectedVersion);}
export function externalCookieName(id:string){return'qgauss_external_'+externalKey(id).replaceAll('-','');}
export function externalCookieProof(header:unknown,id:string){if(typeof header!=='string'||header.length>16384)throw externalMissing();const name=externalCookieName(id),values=header.split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));if(values.length!==1)throw externalMissing();return externalProof(values[0].slice(name.length+1));}
