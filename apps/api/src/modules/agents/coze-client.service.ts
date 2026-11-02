import { Injectable } from '@nestjs/common';
import { createPrivateKey,randomUUID,sign } from 'node:crypto';
import { SecretBox } from '../../common/crypto/secret-box';
import { safeFetch } from '../../common/net/safe-fetch';
import { UpstreamError } from '../../common/llm/chat-protocol';
import { cozeEndpoint } from '../../common/llm/coze-protocol';

export type AgentCredential = {id:string;baseUrl:string;authMode:string;appId?:string|null;publicKeyId?:string|null;secretEnc:string;version:number;timeoutMs:number};
type CachedToken={value:string;expiresAt:number};

export function validatedAgentSecret(mode:string,secret:string) {
  if(mode==='PAT'){
    const value=secret.trim();if(value.length<8||value.length>8192||/[\s\u0000-\u001f\u007f]/.test(value))throw new UpstreamError(400,'invalid agent token','访问令牌应为完整、无空白字符的有效字符串');return value;
  }
  if(mode!=='JWT')throw new UpstreamError(400,'invalid agent auth mode','请选择受支持的授权方式');
  let value=secret.trim().replace(/\\n/g,'\n');if(!value.startsWith('-----BEGIN'))value='-----BEGIN PRIVATE KEY-----\n'+value+'\n-----END PRIVATE KEY-----';
  try{if(value.length>16384)throw Error();const key=createPrivateKey(value);if(key.asymmetricKeyType!=='rsa'||!key.asymmetricKeyDetails?.modulusLength||key.asymmetricKeyDetails.modulusLength<2048||key.asymmetricKeyDetails.modulusLength>8192)throw Error();return key.export({format:'pem',type:'pkcs8'}).toString();}catch{throw new UpstreamError(400,'invalid agent RSA key','授权私钥需为有效的 2048 至 8192 位 RSA 私钥');}
}

export function signCozeAssertion(connection:Pick<AgentCredential,'baseUrl'|'appId'|'publicKeyId'>,secret:string,now=Date.now()) {
  if(!connection.appId||!connection.publicKeyId)throw new UpstreamError(400,'missing agent JWT identity','OAuth 授权需要应用 ID 与公钥指纹');
  const header={alg:'RS256',typ:'JWT',kid:connection.publicKeyId},issued=Math.floor(now/1000),payload={iss:connection.appId,aud:new URL(connection.baseUrl).host,iat:issued,exp:issued+300,jti:randomUUID()};
  const encoded=[header,payload].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return encoded+'.'+sign('RSA-SHA256',Buffer.from(encoded),validatedAgentSecret('JWT',secret)).toString('base64url');
}

async function boundedJson(response:Response,maxBytes=2_000_000):Promise<any> {
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new UpstreamError(response.status,'agent HTTP error',response.status===401||response.status===403?'智能体授权未通过，请联系管理员核对。':'智能体服务暂未完成请求，请稍后明确重试。');}
  if(!response.body||!(response.headers.get('content-type')||'').toLowerCase().includes('json')){await response.body?.cancel().catch(()=>{});throw new UpstreamError(502,'invalid agent JSON response','智能体服务返回的格式不正确，请核对连接地址。');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new UpstreamError(502,'agent metadata too large','智能体服务返回的信息超过本站可处理的范围');parts.push(part.value);}let json:any;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw new UpstreamError(502,'invalid agent JSON');}if(!json||typeof json!=='object'||Array.isArray(json))throw new UpstreamError(502,'invalid agent JSON shape');if(json.code!==undefined&&json.code!==0)throw new UpstreamError(502,'agent API rejection','智能体服务没有接受本次请求，请联系管理员核对权限与参数。');return json;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

@Injectable()
export class CozeClientService {
  private readonly tokens=new Map<string,CachedToken>();
  private readonly pending=new Map<string,Promise<CachedToken>>();
  constructor(private readonly box:SecretBox){}
  private cacheKey(connection:AgentCredential){return connection.id+':'+connection.version;}
  invalidate(connection:AgentCredential){this.tokens.delete(this.cacheKey(connection));}
  async accessToken(connection:AgentCredential,signal?:AbortSignal):Promise<string>{
    signal?.throwIfAborted();const secret=this.box.decrypt(connection.secretEnc);if(!secret)throw new UpstreamError(400,'missing agent credential','智能体连接尚未保存授权凭据');
    if(connection.authMode==='PAT')return validatedAgentSecret('PAT',secret);
    const key=this.cacheKey(connection),cached=this.tokens.get(key);if(cached&&cached.expiresAt>Date.now()+60000)return cached.value;
    let flight=this.pending.get(key);
    if(!flight){
      flight=(async()=>{const assertion=signCozeAssertion(connection,secret),response=await safeFetch(cozeEndpoint(connection.baseUrl,'/api/permission/oauth2/token'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+assertion},body:JSON.stringify({duration_seconds:900,grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer'})},{timeoutMs:10000,signal:AbortSignal.timeout(10000)});const json=await boundedJson(response),data=json.access_token?json:json.data;if(typeof data?.access_token!=='string'||data.access_token.length<8||data.access_token.length>8192||/[\s\u0000-\u001f\u007f]/.test(data.access_token))throw new UpstreamError(502,'invalid agent access token','智能体授权没有返回有效访问凭据');const expiry=Number(data.expires_in),expiresAt=Number.isSafeInteger(expiry)&&expiry>0?Math.min(Date.now()+86400000,(expiry>1_000_000_000?expiry*1000:Date.now()+expiry*1000)):Date.now();const token={value:data.access_token,expiresAt};for(const[id,value]of this.tokens)if(value.expiresAt<=Date.now())this.tokens.delete(id);if(this.tokens.size>=256)this.tokens.delete(this.tokens.keys().next().value!);this.tokens.set(key,token);return token;})();this.pending.set(key,flight);void flight.finally(()=>{if(this.pending.get(key)===flight)this.pending.delete(key);}).catch(()=>{});
    }
    // A canceled observer does not cancel a shared OAuth exchange needed by another accepted request.
    if(!signal)return(await flight).value;
    return new Promise<string>((resolve,reject)=>{const abort=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();flight!.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(value.value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
  }
  async request(connection:AgentCredential,path:string,init:RequestInit={},options:{query?:Record<string,string>;signal?:AbortSignal;timeoutMs?:number}={}){
    const token=await this.accessToken(connection,options.signal),headers=new Headers(init.headers);headers.set('Authorization','Bearer '+token);if(init.body&&!(init.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
    const timeout=options.timeoutMs||connection.timeoutMs||60000,signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    const response=await safeFetch(cozeEndpoint(connection.baseUrl,path,options.query),{...init,headers},{timeoutMs:timeout,signal});if(response.status===401||response.status===403)this.invalidate(connection);return response;
  }
  async json(connection:AgentCredential,path:string,init:RequestInit={},options:{query?:Record<string,string>;signal?:AbortSignal;timeoutMs?:number}={}){return boundedJson(await this.request(connection,path,init,options));}
}
