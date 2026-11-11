const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const time=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const count=value=>Number.isSafeInteger(value)&&value>=0;
const proof=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const privateFields=['openId','openid','unionId','appSecret','accessToken','refreshToken','password','browserProof','providerToken','sessionCipher'];
const clean=value=>value&&typeof value==='object'&&!Array.isArray(value)&&privateFields.every(key=>!Object.hasOwn(value,key));
export const EXTERNAL_ACTIVE=Object.freeze(['preparing','waiting','confirmed','unknown']);
export function newExternalRequest(cryptoObject=globalThis.crypto){
 if(typeof cryptoObject?.randomUUID!=='function'||typeof cryptoObject?.getRandomValues!=='function')throw Error('当前环境无法准备安全连接，请使用安全地址打开。');
 const bytes=cryptoObject.getRandomValues(new Uint8Array(32));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return{requestKey:cryptoObject.randomUUID(),browserProof:btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),version:0};
}
export function externalPending(value,owner,purpose){
 if(!value||value.owner!==owner||value.purpose!==purpose||!['login','link'].includes(purpose)||!['qr','browser'].includes(value.method)||!uuid(value.requestKey)||!proof(value.browserProof)||!count(value.version))return null;
 return{owner,purpose,method:value.method,requestKey:value.requestKey,browserProof:value.browserProof,version:value.version};
}
export function externalHeaders(browserProof){if(!proof(browserProof))throw Error('这次连接凭据不完整，请结束后重新准备。');return{'X-QGauss-Identity':browserProof};}
export function externalPolicy(value){
 return!!(clean(value)&&typeof value.ready==='boolean'&&typeof value.registrationEnabled==='boolean'&&typeof value.inviteRequired==='boolean'&&typeof value.methods?.qr==='boolean'&&typeof value.methods?.browser==='boolean'&&count(value.expiresInSeconds)&&value.expiresInSeconds>=30&&value.expiresInSeconds<=600&&time(value.serverNow)&&(!value.ready||value.methods.qr||value.methods.browser));
}
export function externalAuthorization(value,origin=globalThis.location?.origin){
 try{const url=new URL(value),target=new URL(url.searchParams.get('redirect_uri'));return url.origin==='https://open.weixin.qq.com'&&url.pathname==='/connect/oauth2/authorize'&&!url.username&&!url.password&&url.searchParams.get('response_type')==='code'&&url.searchParams.get('scope')==='snsapi_base'&&/^[A-Za-z0-9_-]{32,64}$/.test(url.searchParams.get('state')||'')&&target.origin===origin&&target.pathname==='/api/auth/external/callback'&&!target.search&&!target.hash&&(!url.hash||url.hash==='#wechat_redirect');}catch{return false;}
}
export function externalReceipt(value,pending,origin=globalThis.location?.origin){
 if(!clean(value)||!pending||value.requestKey!==pending.requestKey||value.purpose!==pending.purpose||value.method!==pending.method||!count(value.version)||value.version<pending.version||!time(value.serverNow)||!time(value.expiresAt)||!['preparing','waiting','confirmed','applied','expired','closed','failed','unknown'].includes(value.status))throw Error('这次连接结果尚未核对完整，请重新读取。');
 if(value.purpose==='link'&&value.ownerId!==pending.owner)throw Error('这次连接不属于当前账户。');
 if(value.qrImage!==null&&value.qrImage!==undefined&&(value.method!=='qr'||value.status!=='waiting'||typeof value.qrImage!=='string'||value.qrImage.length>200000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.qrImage)))throw Error('这次扫码画面尚未准备完整，请重新读取。');
 if(value.authorizationUrl!==null&&value.authorizationUrl!==undefined&&(value.method!=='browser'||value.status!=='waiting'||!externalAuthorization(value.authorizationUrl,origin)))throw Error('这次跳转地址尚未核对完整，请重新读取。');
 if(value.purpose==='login'&&value.status==='applied'&&(typeof value.exchangeAvailable!=='boolean'||typeof value.accepted!=='boolean'))throw Error('这次登录结果尚未核对完整，请重新读取。');
 return value;
}
export function externalIdentity(value,owner){
 if(!clean(value)||value.userId!==owner||typeof value.linked!=='boolean'||typeof value.passwordConfigured!=='boolean'||!time(value.readAt)||value.linked&&(typeof value.identityId!=='string'||!time(value.linkedAt)))throw Error('扫码身份暂未读取完整，请重新读取。');return value;
}
export function externalStatusText(status){return({preparing:'正在准备这束连接…',waiting:'等待你在手机上确认',confirmed:'已确认，正在为你接上灵感',applied:'这次连接已经完成',expired:'这束连接已经到期',closed:'这次等待已结束',failed:'这次没有接通，请重新准备',unknown:'暂未确认连接结果'})[status]||'准备一束属于你的连接';}
