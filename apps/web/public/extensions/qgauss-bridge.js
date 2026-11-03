/* QGauss extension bridge. Requests and theme changes stay inside the parent frame channel. */
(function(){
 'use strict';
 const channel='qgauss-extension',pending=new Map(),listeners={theme:new Set(),draft:new Set(),ready:new Set()};let nonce='',parentOrigin='',mode='light',draft='',available=false;
 function emit(name,value){for(const callback of listeners[name]||[])try{callback(value);}catch{}}
 function send(type,data){if(!nonce)return false;window.parent.postMessage({channel,version:1,nonce,type,...data},parentOrigin);return true;}
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||!event.data||event.data.channel!==channel||event.data.version!==1)return;const data=event.data;
  if(data.type==='init'&&typeof data.nonce==='string'&&data.nonce.length<=128){if(nonce&&nonce!==data.nonce){for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('连接已更新，请重新请求。'));}pending.clear();}nonce=data.nonce;parentOrigin=event.origin;mode=data.mode==='dark'?'dark':'light';available=!!data.capabilities?.chat;draft=typeof data.draft==='string'?data.draft:'';emit('theme',mode);emit('draft',draft);emit('ready',{chat:available});return;}
  if(!nonce||data.nonce!==nonce)return;if(data.type==='theme'){mode=data.mode==='dark'?'dark':'light';emit('theme',mode);return;}
  const item=pending.get(data.id);if(!item)return;if(data.type==='ack'){item.progress?.(data.phase);return;}if(data.type!=='result'&&data.type!=='error')return;clearTimeout(item.timer);pending.delete(data.id);if(data.type==='result'&&typeof data.text==='string')item.resolve(data.text);else item.reject(Error(typeof data.message==='string'?data.message:'本次请求未完成。'));
 });
 function on(name,callback){listeners[name].add(callback);if(nonce){if(name==='theme')callback(mode);if(name==='draft')callback(draft);if(name==='ready')callback({chat:available});}return()=>listeners[name].delete(callback);}
 window.QGaussBridge=Object.freeze({
  onTheme:callback=>on('theme',callback),onDraft:callback=>on('draft',callback),onReady:callback=>on('ready',callback),
  setTheme:value=>send('theme',{mode:value==='dark'?'dark':'light'}),
  saveDraft:value=>typeof value==='string'&&value.length<=8000&&send('draft',{draft:value}),
  requestChat(prompt,{onProgress}={}){if(!nonce||!available)return Promise.reject(Error('创作搭档尚未连接，请稍后再试。'));if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)return Promise.reject(Error('请填写不超过 4000 字的内容。'));if(pending.size>=1)return Promise.reject(Error('请先完成当前请求。'));const random=new Uint8Array(16);crypto.getRandomValues(random);const id=Array.from(random,value=>value.toString(16).padStart(2,'0')).join('');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('等待较久，请在工作台核对这次请求的状态。'));},600000);pending.set(id,{resolve,reject,timer,progress:onProgress});send('chat',{id,prompt:prompt.trim()});});},
 });
 window.parent.postMessage({channel,version:1,type:'ready'},'*');
})();
