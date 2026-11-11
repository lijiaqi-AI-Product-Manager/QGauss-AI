import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {SaxesParser} from 'saxes';
import {externalBad,externalEqual} from './external-input';
const utf8=new TextDecoder('utf-8',{fatal:true});
export function externalXml(value:string){
 if(typeof value!=='string'||!value||Buffer.byteLength(value)>65536)throw externalBad();let depth=0,root=false,field='',text='',ended=false;const fields:Record<string,string>={},parser=new SaxesParser({xmlns:false,position:false});
 parser.on('doctype',()=>{throw externalBad();});parser.on('processinginstruction',()=>{throw externalBad();});parser.on('error',()=>{throw externalBad();});
 parser.on('opentag',node=>{depth++;if(depth>2||ended||Object.keys(node.attributes).length)throw externalBad();if(depth===1){if(root||node.name!=='xml')throw externalBad();root=true;}else{if(!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(node.name)||Object.hasOwn(fields,node.name)||Object.keys(fields).length>=16)throw externalBad();field=node.name;text='';}});
 const append=(value:string)=>{if(depth===2){text+=value;if(text.length>32768)throw externalBad();}else if(value.trim())throw externalBad();};parser.on('text',append);parser.on('cdata',append);parser.on('closetag',()=>{if(depth===2){fields[field]=text;field='';text='';}depth--;if(depth===0)ended=true;});
 try{parser.write(value).close();}catch{throw externalBad();}if(!root||!ended||depth!==0)throw externalBad();return fields;
}
function base64(value:string,max=180000){if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>max)throw externalBad();const bytes=Buffer.from(value,'base64');if(bytes.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))throw externalBad();return bytes;}
export function externalSignature(token:string,timestamp:string,nonce:string,encrypted?:string){return createHash('sha1').update([token,timestamp,nonce,...(encrypted===undefined?[]:[encrypted])].sort().join('')).digest('hex');}
export function verifyExternalSignature(signature:unknown,timestamp:unknown,nonce:unknown,token:string,encrypted?:string,now=Date.now()){
 if(typeof signature!=='string'||!/^[a-f0-9]{40}$/i.test(signature)||typeof timestamp!=='string'||!/^[1-9]\d{8,10}$/.test(timestamp)||Math.abs(Number(timestamp)*1000-now)>300000||typeof nonce!=='string'||!nonce||nonce.length>128||!/^[\x21-\x7e]+$/.test(nonce)||!token)throw externalBad('连接来源尚未通过核对。',401);
 if(!externalEqual(signature.toLowerCase(),externalSignature(token,timestamp,nonce,encrypted)))throw externalBad('连接来源尚未通过核对。',401);
}
export function decryptExternalMessage(encrypted:string,encodingKey:string,appId:string){
 try{
  if(!/^[A-Za-z0-9+/]{43}$/.test(encodingKey))throw externalBad();const key=base64(encodingKey+'=',44);if(key.length!==32)throw externalBad();const input=base64(encrypted);if(!input.length||input.length%32)throw externalBad();const cipher=createDecipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);const plain=Buffer.concat([cipher.update(input),cipher.final()]),pad=plain.at(-1)!;if(pad<1||pad>32||plain.length<pad+21||!plain.subarray(-pad).every(value=>value===pad))throw externalBad();const content=plain.subarray(0,-pad),length=content.readUInt32BE(16);if(length<1||length>65536||20+length>=content.length||!externalEqual(utf8.decode(content.subarray(20+length)),appId))throw externalBad();return utf8.decode(content.subarray(20,20+length));
 }catch{throw externalBad('连接来源尚未通过核对。',401);}
}
export function encryptExternalMessage(message:string,encodingKey:string,appId:string,randomPrefix=randomBytes(16)){
 if(randomPrefix.length!==16||Buffer.byteLength(message)>65536||!/^[A-Za-z0-9+/]{43}$/.test(encodingKey))throw externalBad();const key=base64(encodingKey+'=',44),body=Buffer.from(message),size=Buffer.alloc(4);size.writeUInt32BE(body.length);const plain=Buffer.concat([randomPrefix,size,body,Buffer.from(appId)]),pad=32-plain.length%32,cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);return Buffer.concat([cipher.update(Buffer.concat([plain,Buffer.alloc(pad,pad)])),cipher.final()]).toString('base64');
}
