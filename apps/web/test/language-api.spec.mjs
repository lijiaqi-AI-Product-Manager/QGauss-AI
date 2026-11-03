import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {api,uploadAppImage,fetchBlob,streamChat,resumeChat,setAccessToken,setRefreshHandler} from '../src/api/client.js';
const originalFetch=globalThis.fetch,originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
const doc=lang=>Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{lang}}});
afterEach(()=>{globalThis.fetch=originalFetch;setAccessToken('');setRefreshHandler(null);if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete globalThis.document;});
const reply=data=>new Response(JSON.stringify({code:0,data}),{headers:{'Content-Type':'application/json'}});
const frame=(id,event,data)=>`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
test('JSON, multipart and private files use the visible language without changing payloads or authorization',async()=>{
 doc('en');setAccessToken('local-token');const calls=[];globalThis.fetch=async(path,init)=>{calls.push({path,init});return path.endsWith('/raw')?new Response('png',{headers:{'Content-Type':'image/png'}}):reply({ok:true});};
 await api.post('/apps/mine',{name:'QGauss',requestKey:'unchanged'});await uploadAppImage(new File(['png'],'image.png',{type:'image/png'}),'operation',{x:0,y:0,size:1,width:1,height:1});await fetchBlob('/api/apps/icons/sample/raw');
 assert.equal(calls.length,3);for(const {init}of calls){const headers=new Headers(init.headers);assert.equal(headers.get('accept-language'),'en');assert.equal(headers.get('authorization'),'Bearer local-token');}assert.deepEqual(JSON.parse(calls[0].init.body),{name:'QGauss',requestKey:'unchanged'});assert.equal(calls[1].init.body.get('requestKey'),'operation');assert.equal(calls[1].init.body.get('file').name,'image.png');assert.equal(new Headers(calls[1].init.headers).has('content-type'),false);
});
test('an unsaved manual language is sent from the document without reading browser storage',async()=>{
 doc('zh-TW');const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Blocked');}});try{let header;globalThis.fetch=async(_path,init)=>{header=new Headers(init.headers).get('accept-language');return reply({});};await api.get('/settings/public');assert.equal(header,'zh-TW');}finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
});
test('chat reconnects keep the accepted language and reuse the same task without a second POST',async()=>{
 doc('en');setAccessToken('local-token');const calls=[];globalThis.fetch=async(path,init)=>{calls.push({path,method:init.method,language:new Headers(init.headers).get('accept-language')});if(calls.length===1){document.documentElement.lang='zh-TW';return new Response(frame(1,'meta',{messageId:'m1',conversationId:'c1'})+frame(2,'delta',{v:'one'}),{headers:{'Content-Type':'text/event-stream'}});}return new Response(frame(3,'done',{status:'COMPLETED'}),{headers:{'Content-Type':'text/event-stream'}});};const run=streamChat({messages:[]});assert.equal((await run.finished).ended,'done');assert.deepEqual(calls.map(c=>[c.method,c.language]),[['POST','en'],['GET','en']]);
});
test('opening a saved chat observes it in the current interface language without generating again',async()=>{
 doc('zh-TW');setAccessToken('local-token');let seen;globalThis.fetch=async(path,init)=>{seen={path,method:init.method,language:new Headers(init.headers).get('accept-language')};return new Response(frame(1,'done',{status:'COMPLETED'}),{headers:{'Content-Type':'text/event-stream'}});};assert.equal((await resumeChat('m1').finished).ended,'done');assert.deepEqual(seen,{path:'/api/chat/runs/m1/events',method:'GET',language:'zh-TW'});
});
