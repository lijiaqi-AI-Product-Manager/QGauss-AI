export const EXTENSION_CHANNEL='qgauss-extension';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value);
export function extensionFrameTarget(entry,base=location.href){
 const parent=new URL(base),url=new URL(entry.entryUrl,parent);if(url.username||url.password)throw Error('扩展地址暂时无法打开，请联系管理员调整。');
 if(entry.entryUrl==='/extensions/idea-canvas.html'&&url.origin===parent.origin)return{src:url.href,origin:'null',targetOrigin:'*',sandbox:'allow-scripts',builtin:true};
 if(url.origin===parent.origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&parent.hostname==='127.0.0.1'))throw Error('请为扩展使用独立的 HTTPS 域名，或使用内置画布。');
 return{src:url.href,origin:url.origin,targetOrigin:url.origin,sandbox:'allow-scripts allow-same-origin',builtin:false};
}
export function readExtensionMessage(event,{frame,target,nonce,legacy=false}){
 if(!frame||event.source!==frame||event.origin!==target?.origin)return null;const data=event.data;if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const modern=data.channel===EXTENSION_CHANNEL&&data.version===1;if(!modern&&(data.channel!==undefined||data.version!==undefined))return null;
 if(modern&&data.type==='ready')return{type:'ready',legacy:false};
 if(modern&&data.nonce!==nonce||!modern&&(!legacy||target.origin==='null'))return null;
 if(data.type==='theme'){const mode=modern?data.mode:data.data;return mode==='dark'||mode==='light'?{type:'theme',mode,legacy:!modern}:null;}
 if(data.type==='draft'&&modern&&target.builtin&&typeof data.draft==='string'&&data.draft.length<=8000)return{type:'draft',draft:data.draft,legacy:false};
 if(data.type==='cancel'&&modern&&id(data.id))return{type:'cancel',id:data.id,legacy:false};
 if(data.type!=='chat'||modern&&!id(data.id))return null;const prompt=modern?data.prompt:data.data;
 if(typeof prompt!=='string'||prompt.length>4000||!prompt.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt))return null;
 return{type:'chat',id:modern?data.id:null,prompt:prompt.trim(),legacy:!modern};
}
export function extensionHostMessage(type,{nonce,id:requestId,mode='light',title='',chat=false,draft='',phase,text='',error=''}={}){
 if(typeof nonce!=='string'||nonce.length<8||nonce.length>128)throw Error('扩展连接标识无效。');const base={channel:EXTENSION_CHANNEL,version:1,nonce,type};
 if(type==='init')return{...base,mode:mode==='dark'?'dark':'light',title:String(title).slice(0,40),capabilities:{chat:!!chat},draft:typeof draft==='string'?draft.slice(0,8000):''};
 if(type==='theme')return{...base,mode:mode==='dark'?'dark':'light'};
 if(!id(requestId))throw Error('扩展请求标识无效。');
 if(type==='ack')return{...base,id:requestId,phase:['review','running','recovering','canceling'].includes(phase)?phase:'review'};
 if(type==='result')return{...base,id:requestId,text:String(text).slice(0,200000)};
 if(type==='error')return{...base,id:requestId,message:String(error||'本次请求暂时未完成。').slice(0,400)};
 throw Error('未开放的扩展交互。');
}
export function createExtensionDeliveryCache(limit=32){
 const rows=new Map();return{
  offer(key,prompt){const existing=rows.get(key);if(existing)return{state:existing.prompt===prompt?existing.state:'conflict',record:existing};while(rows.size>=limit){const victim=[...rows].find(([,row])=>row.state!=='pending');if(!victim)return{state:'busy'};rows.delete(victim[0]);}const record={prompt,state:'pending',text:'',error:''};rows.set(key,record);return{state:'new',record};},
  finish(key,prompt,{text='',error=''}={}){const row=rows.get(key);if(!row||row.prompt!==prompt)return false;Object.assign(row,{state:'done',text:String(text).slice(0,200000),error:String(error).slice(0,400)});return true;},
  clear(){rows.clear();},get size(){return rows.size;},
 };
}
