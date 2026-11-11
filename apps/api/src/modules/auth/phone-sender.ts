import {createHash,createHmac,randomUUID} from 'node:crypto';

type Environment=Record<string,string|undefined>;
export function phoneSenderConfiguration(env:Environment){
  const enabled=['true','1'].includes(env.SMS_ENABLED||''),accessKeyId=(env.SMS_ACCESS_KEY_ID||'').trim(),accessKeySecret=(env.SMS_ACCESS_KEY_SECRET||'').trim(),signName=(env.SMS_SIGN_NAME||'').trim(),templateCode=(env.SMS_TEMPLATE_CODE||'').trim(),securityToken=(env.SMS_SECURITY_TOKEN||'').trim(),variable=(env.SMS_CODE_VARIABLE||'code').trim();
  const issues:string[]=[];
  if(!/^[a-zA-Z0-9]{8,128}$/.test(accessKeyId))issues.push('SMS_ACCESS_KEY_ID');
  if(accessKeySecret.length<16||accessKeySecret.length>256||/[\r\n]/.test(accessKeySecret))issues.push('SMS_ACCESS_KEY_SECRET');
  if(!signName||[...signName].length>60||/[\r\n]/.test(signName))issues.push('SMS_SIGN_NAME');
  if(!/^SMS_\d{1,40}$/.test(templateCode))issues.push('SMS_TEMPLATE_CODE');
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(variable))issues.push('SMS_CODE_VARIABLE');
  if(securityToken.length>4096||/[\r\n]/.test(securityToken))issues.push('SMS_SECURITY_TOKEN');
  return{enabled,ready:enabled&&!issues.length,issues,accessKeyId,accessKeySecret,signName,templateCode,securityToken,variable};
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());

/** ACS3 request signing: https://www.alibabacloud.com/help/en/sdk/product-overview/v3-request-structure-and-signature */
export function signPhoneRequest(input:{host:string;action:string;version:string;query:Record<string,string>;accessKeyId:string;accessKeySecret:string;securityToken?:string;now?:Date;nonce?:string}){
  const query=Object.keys(input.query).sort().map(key=>encode(key)+'='+encode(input.query[key])).join('&');
  const headers:Record<string,string>={host:input.host,'x-acs-action':input.action,'x-acs-content-sha256':hash(''),'x-acs-date':(input.now||new Date()).toISOString().replace(/\.\d{3}Z$/,'Z'),'x-acs-signature-nonce':input.nonce||randomUUID(),'x-acs-version':input.version};
  if(input.securityToken)headers['x-acs-security-token']=input.securityToken;
  const keys=Object.keys(headers).sort(),signedHeaders=keys.join(';'),canonicalHeaders=keys.map(key=>key+':'+headers[key].trim()+'\n').join(''),canonical=['POST','/',query,canonicalHeaders,signedHeaders,hash('')].join('\n');
  const signature=createHmac('sha256',input.accessKeySecret).update('ACS3-HMAC-SHA256\n'+hash(canonical)).digest('hex');
  headers.authorization='ACS3-HMAC-SHA256 Credential='+input.accessKeyId+',SignedHeaders='+signedHeaders+',Signature='+signature;
  return{url:'https://'+input.host+'/?'+query,headers};
}
export type PhoneSendResult={status:'SUBMITTED'|'FAILED'|'UNKNOWN';messageId?:string};

export class PhoneSender {
  constructor(private readonly environment:Environment=process.env,private readonly transport:typeof fetch=fetch){}
  summary(){const config=phoneSenderConfiguration(this.environment);return{ready:config.ready,enabled:config.enabled,provider:'aliyun',issues:[...config.issues]};}
  /** No automatic retry: an uncertain response may already represent a billable text. */
  async send(phone:string,code:string,requestKey:string):Promise<PhoneSendResult>{
    const config=phoneSenderConfiguration(this.environment);
    if(!config.ready)return{status:'FAILED'};
    if(!/^\+861[3-9]\d{9}$/.test(phone)||!/^\d{6}$/.test(code))return{status:'FAILED'};
    const request=signPhoneRequest({...config,host:'dysmsapi.aliyuncs.com',action:'SendSms',version:'2017-05-25',query:{PhoneNumbers:phone.slice(3),SignName:config.signName,TemplateCode:config.templateCode,TemplateParam:JSON.stringify({[config.variable]:code}),OutId:requestKey}});
    try{
      const response=await this.transport(request.url,{method:'POST',headers:{...request.headers,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10_000)});
      const length=Number(response.headers.get('content-length'));
      if(length>65_536||!response.body){void response.body?.cancel().catch(()=>{});return{status:'UNKNOWN'};}
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
      try{while(true){const row=await reader.read();if(row.done)break;bytes+=row.value.byteLength;if(bytes>65_536){await reader.cancel();return{status:'UNKNOWN'};}chunks.push(row.value);}}finally{reader.releaseLock();}
      let row:any;try{row=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return{status:'UNKNOWN'};}
      if(response.ok&&row?.Code==='OK')return{status:'SUBMITTED',...(typeof row.BizId==='string'&&row.BizId.length<=128?{messageId:row.BizId}:{})};
      if(response.status<500&&typeof row?.Code==='string'&&row.Code!=='OK')return{status:'FAILED'};
      return{status:'UNKNOWN'};
    }catch{return{status:'UNKNOWN'};}
  }
}
