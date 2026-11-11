import {Inject,Injectable,Optional} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {PrismaService} from '../../common/prisma/prisma.service';
import {SecretBox} from '../../common/crypto/secret-box';
import {externalHash} from './external-input';
export class ExternalProviderError extends Error {constructor(readonly outcome:'failed'|'unknown',readonly providerCode?:number){super('扫码服务暂时未接通，请核对后再试。');}}
export type ExternalConfiguration={enabled:boolean;ready:boolean;appId:string;secret:string;callbackToken:string;encodingKey:string;origin:string;accountId:string;missing:string[]};
export function externalConfiguration(config:ConfigService):ExternalConfiguration{
 const get=(key:string)=>{const value=config.get<unknown>(key);return typeof value==='string'?value.trim():'';},enabled=get('EXTERNAL_ENABLED')==='true',appId=get('EXTERNAL_APP_ID'),secret=get('EXTERNAL_APP_SECRET'),callbackToken=get('EXTERNAL_CALLBACK_TOKEN'),encodingKey=get('EXTERNAL_ENCODING_AES_KEY'),accountId=get('EXTERNAL_ACCOUNT_ID'),rawOrigin=get('EXTERNAL_PUBLIC_ORIGIN'),missing:string[]=[];let origin='';
 if(!/^wx[A-Za-z0-9]{16}$/.test(appId))missing.push('EXTERNAL_APP_ID');if(!/^[A-Za-z0-9_-]{16,128}$/.test(secret))missing.push('EXTERNAL_APP_SECRET');if(!/^[A-Za-z0-9]{3,32}$/.test(callbackToken))missing.push('EXTERNAL_CALLBACK_TOKEN');if(!/^[A-Za-z0-9+/]{43}$/.test(encodingKey)||Buffer.from(encodingKey+'=','base64').length!==32||Buffer.from(encodingKey+'=','base64').toString('base64').slice(0,-1)!==encodingKey)missing.push('EXTERNAL_ENCODING_AES_KEY');
 try{const url=new URL(rawOrigin),local=config.get('NODE_ENV')!=='production'&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);if(url.protocol!=='https:'&&!local||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();origin=url.origin;}catch{missing.push('EXTERNAL_PUBLIC_ORIGIN');}
 if(accountId&&!/^[A-Za-z0-9_-]{1,128}$/.test(accountId))missing.push('EXTERNAL_ACCOUNT_ID');return{enabled,ready:enabled&&missing.length===0,appId,secret,callbackToken,encodingKey,origin,accountId,missing};
}
@Injectable()
export class ExternalProviderService{
 constructor(private readonly config:ConfigService,private readonly prisma:PrismaService,private readonly box:SecretBox,@Optional() @Inject('QGAUSS_EXTERNAL_HTTP') private readonly transport:typeof fetch=fetch){}
 configuration(){return externalConfiguration(this.config);}
 private ready(){const value=this.configuration();if(!value.ready)throw new ExternalProviderError('failed');return value;}
 private async bytes(url:URL,init:RequestInit={},max=65536){
  try{const response=await this.transport(url,{...init,redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok){void response.body?.cancel().catch(()=>undefined);throw new ExternalProviderError(response.status>=500||response.status===408||response.status===429?'unknown':'failed');}const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max)){void response.body?.cancel().catch(()=>undefined);throw new ExternalProviderError('unknown');}if(!response.body)throw new ExternalProviderError('unknown');const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max){await reader.cancel();throw new ExternalProviderError('unknown');}parts.push(item.value);}}finally{reader.releaseLock();}return Buffer.concat(parts);
  }catch(error){if(error instanceof ExternalProviderError)throw error;throw new ExternalProviderError('unknown');}
 }
 private async json(url:URL,init:RequestInit={}){try{const bytes=await this.bytes(url,init),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw new ExternalProviderError('unknown');if(data.errcode!==undefined&&data.errcode!==0)throw new ExternalProviderError(Number.isSafeInteger(data.errcode)?'failed':'unknown',Number.isSafeInteger(data.errcode)?data.errcode:undefined);return data as Record<string,unknown>;}catch(error){if(error instanceof ExternalProviderError)throw error;throw new ExternalProviderError('unknown');}}
 private cached(row:{credentialHash:string;tokenEnc:string|null;tokenExpiresAt:Date|null}|null,credentialHash:string){
  if(!row||row.credentialHash!==credentialHash||!row.tokenEnc||!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+60000)return null;try{const token=this.box.decrypt(row.tokenEnc);return token&&token.length<=8192&&!/[\x00-\x20]/.test(token)?token:null;}catch{return null;}
 }
 private async token(config:ExternalConfiguration){
  const id='official:'+config.appId,credentialHash=externalHash(config.appId+'\0'+config.secret),now=new Date(),leaseOwner=randomUUID();
  const access=await this.prisma.$transaction(async tx=>{
   await tx.externalProviderState.updateMany({where:{id},data:{version:{increment:0}}});
   const row=await tx.externalProviderState.findUnique({where:{id}}),cached=this.cached(row,credentialHash);if(cached)return{cached};
   if(row?.credentialHash===credentialHash&&row.leaseUntil&&row.leaseUntil>now)return{waiting:true};
   const value=await tx.externalProviderState.upsert({where:{id},create:{id,credentialHash,leaseOwner,leaseUntil:new Date(Date.now()+15000)},update:{credentialHash,leaseOwner,leaseUntil:new Date(Date.now()+15000),tokenEnc:null,tokenExpiresAt:null,version:{increment:1}}});return{version:value.version};
  });if(access.cached)return access.cached;
  if(access.waiting){for(let attempt=0;attempt<50;attempt++){await delay(100);const row=await this.prisma.externalProviderState.findUnique({where:{id}}),token=this.cached(row,credentialHash);if(token)return token;if(!row||row.credentialHash!==credentialHash||!row.leaseOwner)break;}throw new ExternalProviderError('unknown');}
  try{const url=new URL('https://api.weixin.qq.com/cgi-bin/token');url.searchParams.set('grant_type','client_credential');url.searchParams.set('appid',config.appId);url.searchParams.set('secret',config.secret);const data=await this.json(url);if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>8192||/[\x00-\x20]/.test(data.access_token)||!Number.isSafeInteger(data.expires_in)||Number(data.expires_in)<120||Number(data.expires_in)>86400)throw new ExternalProviderError('unknown');const accepted=await this.prisma.externalProviderState.updateMany({where:{id,credentialHash,leaseOwner,version:access.version},data:{tokenEnc:this.box.encrypt(data.access_token),tokenExpiresAt:new Date(Date.now()+Number(data.expires_in)*1000),leaseOwner:null,leaseUntil:null,version:{increment:1}}});if(accepted.count!==1)throw new ExternalProviderError('unknown');return data.access_token;
  }catch(error){await this.prisma.externalProviderState.updateMany({where:{id,credentialHash,leaseOwner,version:access.version},data:{leaseOwner:null,leaseUntil:null,tokenEnc:null,tokenExpiresAt:null,version:{increment:1}}}).catch(()=>undefined);if(error instanceof ExternalProviderError)throw error;throw new ExternalProviderError('unknown');}
 }
 authorization(sceneKey:string){const config=this.ready(),url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');url.searchParams.set('appid',config.appId);url.searchParams.set('redirect_uri',config.origin+'/api/auth/external/callback');url.searchParams.set('response_type','code');url.searchParams.set('scope','snsapi_base');url.searchParams.set('state',sceneKey);url.hash='wechat_redirect';return url.href;}
 async prepareQr(sceneKey:string){
  const config=this.ready(),token=await this.token(config),url=new URL('https://api.weixin.qq.com/cgi-bin/qrcode/create');url.searchParams.set('access_token',token);const data=await this.json(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expire_seconds:300,action_name:'QR_STR_SCENE',action_info:{scene:{scene_str:sceneKey}}})}).catch(async error=>{if(error instanceof ExternalProviderError&&[40001,40014,42001].includes(error.providerCode||0)){const id='official:'+config.appId,row=await this.prisma.externalProviderState.findUnique({where:{id}});if(row?.tokenEnc)try{if(this.box.decrypt(row.tokenEnc)===token)await this.prisma.externalProviderState.updateMany({where:{id,version:row.version},data:{tokenEnc:null,tokenExpiresAt:null,version:{increment:1}}});}catch{}}throw error;});
  if(typeof data.ticket!=='string'||!data.ticket||data.ticket.length>4096||!Number.isSafeInteger(data.expire_seconds)||Number(data.expire_seconds)<30||Number(data.expire_seconds)>300)throw new ExternalProviderError('unknown');
  const imageUrl=new URL('https://mp.weixin.qq.com/cgi-bin/showqrcode');imageUrl.searchParams.set('ticket',data.ticket);const input=await this.bytes(imageUrl,{},524288);
  try{const image=sharp(input,{limitInputPixels:1048576,animated:false}),info=await image.metadata();if(!['png','jpeg'].includes(info.format||'')||!info.width||!info.height||info.width<64||info.height<64||info.width>1024||info.height>1024)throw new ExternalProviderError('unknown');const output=await image.png({compressionLevel:9}).toBuffer();if(output.length>147000)throw new ExternalProviderError('unknown');return{qrImage:'data:image/png;base64,'+output.toString('base64'),ticketHash:externalHash(data.ticket),expiresAt:new Date(Date.now()+Number(data.expire_seconds)*1000),appId:config.appId};
  }catch(error){if(error instanceof ExternalProviderError)throw error;throw new ExternalProviderError('unknown');}
 }
 async exchangeCode(code:string){
  const config=this.ready(),url=new URL('https://api.weixin.qq.com/sns/oauth2/access_token');url.searchParams.set('appid',config.appId);url.searchParams.set('secret',config.secret);url.searchParams.set('code',code);url.searchParams.set('grant_type','authorization_code');const data=await this.json(url);
  if(typeof data.openid!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(data.openid)||typeof data.access_token!=='string'||!data.access_token||typeof data.scope!=='string'||!data.scope.split(',').includes('snsapi_base'))throw new ExternalProviderError('unknown');return{subjectHash:this.subject(data.openid,config.appId),appId:config.appId};
 }
 subject(openId:string,appId:string){return externalHash('weixin-official\0'+appId+'\0'+openId);}
}
