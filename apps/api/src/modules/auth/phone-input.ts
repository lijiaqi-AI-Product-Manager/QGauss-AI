import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {passwordProblem} from '../../common/security/password-policy';

export type PhonePurpose='register'|'recover'|'bind'|'initial';
export const PHONE_CODE_TTL=300_000,PHONE_COOLDOWN=60_000;
const KEY=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const phoneBad=(message='短信验证码错误、过期或已使用',status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
export function phoneKey(value:unknown):string{if(typeof value!=='string'||!KEY.test(value))throw phoneBad('申请标识不正确');return value.toLowerCase();}
export function normalizedPhone(value:unknown):string{
  if(typeof value!=='string'||value.length>40)throw phoneBad('请填写有效的中国大陆手机号码。');
  let digits=value.trim().replace(/[\s()\-]/g,'');
  if(digits.startsWith('+86'))digits=digits.slice(3);else if(digits.startsWith('0086'))digits=digits.slice(4);
  if(!/^1[3-9]\d{9}$/.test(digits))throw phoneBad('请填写有效的中国大陆手机号码。');
  return '+86'+digits;
}
export function maskedPhone(phone:string){return phone.slice(0,6)+'****'+phone.slice(-4);}
function record(input:unknown,keys:string[]):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))throw phoneBad('申请内容不正确');return input as Record<string,unknown>;
}
export function purposeOf(value:unknown,owned=false):PhonePurpose{
  if(owned?!['bind','initial'].includes(value as string):!['register','recover'].includes(value as string))throw phoneBad('短信验证用途不正确');return value as PhonePurpose;
}
function version(value:unknown){if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>=1e9)throw phoneBad('请核对当前申请版本');return value as number;}
function text(value:unknown,max:number,required=false):string{
  if(value===undefined&&!required)return'';if(typeof value!=='string'||value.length>max||required&&!value.length)throw phoneBad('申请内容不正确');return value as string;
}
export function phoneSendInput(input:unknown,owned=false){
  const row=record(input,['phone','purpose','expectedVersion','captchaId','captchaCode']);
  return{phone:normalizedPhone(row.phone),purpose:purposeOf(row.purpose,owned),expectedVersion:version(row.expectedVersion),captchaId:text(row.captchaId,128),captchaCode:text(row.captchaCode,16)};
}
export function phoneCloseInput(input:unknown,owned=false){const row=record(input,['purpose','expectedVersion']);return{purpose:purposeOf(row.purpose,owned),expectedVersion:version(row.expectedVersion)};}
export function phoneLoginInput(input:unknown){const row=record(input,['phone','password']);return{phone:normalizedPhone(row.phone),password:text(row.password,128,true)};}
export function phoneActionInput(input:unknown,owned=false){
  const row=record(input,owned?['purpose','phone','code','password','confirmation','expectedVersion','expectedUpdatedAt']:['purpose','phone','code','password','confirmation','username','inviteCode','expectedVersion']);
  const purpose=purposeOf(row.purpose,owned),phone=normalizedPhone(row.phone),code=text(row.code,6,true),password=text(row.password,128,true),expectedVersion=version(row.expectedVersion);
  if(!/^\d{6}$/.test(code))throw phoneBad('请填写六位短信验证码。');
  if(owned){if(purpose==='initial'){const problem=passwordProblem(password);if(problem)throw phoneBad(problem,422);if(password!==row.confirmation)throw phoneBad('两次填写的新密码不一致。',422);}else if(row.confirmation!==undefined)throw phoneBad('申请内容不正确');const value=row.expectedUpdatedAt;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw phoneBad('请重新读取当前资料后绑定号码');return{purpose,phone,code,password,expectedVersion,expectedUpdatedAt:value,username:'',inviteCode:''};}
  const problem=passwordProblem(password);if(problem)throw phoneBad(problem,422);
  if(password!==row.confirmation)throw phoneBad('两次填写的新密码不一致。',422);
  let username='',inviteCode='';
  if(purpose==='register'){username=text(row.username,20,true).trim();if(!/^[a-zA-Z0-9_-]{3,20}$/.test(username))throw phoneBad('登录名需为 3–20 位字母、数字、下划线或短横线。',422);inviteCode=text(row.inviteCode,64).trim();}
  else if(row.username!==undefined||row.inviteCode!==undefined)throw phoneBad('密码找回申请不需要登录名或邀请码');
  return{purpose,phone,code,password,expectedVersion,expectedUpdatedAt:undefined,username,inviteCode};
}
export type PhoneActionInput=ReturnType<typeof phoneActionInput>;
