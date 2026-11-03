import {computed,onBeforeUnmount,onMounted,reactive,watch} from 'vue';
import {onBeforeRouteUpdate,useRoute,useRouter} from 'vue-router';
import {api,streamChat,resumeChat} from '../api/client.js';
import {useAuth} from '../stores/auth.js';
import {useTheme} from '../stores/theme.js';
import {extensionFrameTarget,readExtensionMessage,extensionHostMessage,createExtensionDeliveryCache} from '../lib/extension-bridge.js';
import {saveExtensionReceipt,readExtensionReceipt,removeExtensionReceipt,saveExtensionDraft,readExtensionDraft} from '../lib/extension-state.js';

const ACTIVE=['PENDING','STREAMING','SETTLING'],TERMINAL=['COMPLETED','FAILED','ABORTED'];
export function useExtensionWorkbench(frame){
 const auth=useAuth(),theme=useTheme(),route=useRoute(),router=useRouter();
 const state=reactive({loading:true,error:'',notice:'',items:[],selected:null,target:null,frameKey:0,frameLoading:false,frameReady:false,frameSlow:false,frameError:'',offer:null,operation:null,stage:'idle',reply:'',operationError:'',receipt:null,maximized:false,connection:'',canceling:false});
 const busy=computed(()=>['preparing','running','checking','canceling','unknown'].includes(state.stage)),mode=computed(()=>theme.isDark.value?'dark':'light'),historyTarget=computed(()=>state.receipt?.conversationId?{path:'/chat',query:{conversation:state.receipt.conversationId}}:null);
 let alive=true,owner=auth.user?.id,identity=auth.identityRevision,revision=0,nonce='',loaded=false,initialized=false,blocked=false,slowTimer,transport,observer=0,readController,operationController;
 const cache=createExtensionDeliveryCache(),hits={chat:[],theme:[]};
 const current=(id=owner,session=identity)=>alive&&auth.isLoggedIn&&auth.user?.id===id&&auth.identityRevision===session;
 const validOperation=op=>current()&&state.operation===op;
 const rate=(kind,limit)=>{const now=Date.now();hits[kind]=hits[kind].filter(value=>now-value<60000);if(hits[kind].length>=limit)return false;hits[kind].push(now);return true;};
 function frameWindow(){const element=frame.value;return element&&String(element.dataset.epoch)===String(state.frameKey)?element.contentWindow:null;}
 function send(type,data={},operation){
  if(!current()||!state.target||!nonce||!frameWindow())return;if(operation&&(operation.frameKey!==state.frameKey||operation.nonce!==nonce||operation.extensionId!==state.selected?.id))return;
  try{if(operation?.legacy){if(type==='result')frameWindow().postMessage({type:'chat',data:data.text||''},state.target.targetOrigin);else if(type==='error')frameWindow().postMessage({type:'error',data:data.error||'本次请求暂未完成。'},state.target.targetOrigin);return;}
   frameWindow().postMessage(extensionHostMessage(type,{...data,nonce}),state.target.targetOrigin);
  }catch{state.frameError='暂时无法把消息送回扩展，结果仍保留在工作台。';}
 }
 function initializeFrame(){if(!current()||!state.selected||!frameWindow()||initialized||blocked)return;initialized=true;nonce=crypto.randomUUID();state.frameReady=true;state.frameLoading=false;clearTimeout(slowTimer);send('init',{mode:mode.value,title:state.selected.title,chat:state.selected.chatEnabled,draft:readExtensionDraft(owner,state.selected)});if(state.selected.legacyBridge)frameWindow().postMessage({type:'theme',data:mode.value},state.target.targetOrigin);}
 function frameLoaded(event){if(event?.currentTarget&&event.currentTarget!==frame.value||!frameWindow())return;if(loaded){rejectOffer('画布已经变化，请重新打开后再继续。');blocked=true;nonce='';initialized=false;cache.clear();state.frameReady=false;state.frameLoading=false;state.frameError='扩展页面已经更换，请点击重新打开，再继续交互。';return;}loaded=true;if(state.selected?.legacyBridge)initializeFrame();else if(!initialized){state.frameLoading=false;state.frameSlow=true;state.frameError='页面已打开，正在等待扩展建立交互连接。';}}
 function frameFailed(){state.frameLoading=false;state.frameReady=false;state.frameError='扩展暂时没有打开，可以重试，或在新窗口查看。';}
 function resetFrame(){clearTimeout(slowTimer);nonce='';loaded=false;initialized=false;blocked=false;cache.clear();state.frameKey++;state.frameReady=false;state.frameLoading=!!state.selected;state.frameSlow=false;state.frameError='';if(state.selected)slowTimer=setTimeout(()=>{if(current()&&!state.frameReady){state.frameLoading=false;state.frameSlow=true;state.frameError='扩展响应较慢。如果没有显示内容，可以在新窗口打开。';}},15000);}
 function rejectOffer(message='这次请求暂不继续。'){
  const offer=state.offer;if(!offer)return;cache.finish(offer.cacheKey,offer.prompt,{error:message});send('error',{id:offer.id,error:message},offer);state.offer=null;if(!state.operation)state.stage='idle';
 }
 async function open(entry,{fromRoute=false}={}){if(!current())return;if(busy.value){state.notice='请先核对当前请求的结果，再切换扩展。';return;}rejectOffer();state.selected=entry;state.error='';state.notice='';try{state.target=extensionFrameTarget(entry);resetFrame();if(!fromRoute)await router.replace({path:'/extend',query:{...route.query,id:entry.id}});}catch(error){state.target=null;state.frameError=error.message;}}
 async function reload(){if(!busy.value&&state.selected)await load();}
 function close({fromRoute=false}={}){if(busy.value)return;rejectOffer();state.selected=state.target=null;state.maximized=false;resetFrame();if(!fromRoute){const query={...route.query};delete query.id;void router.replace({path:'/extend',query});}}
 async function load(){
  readController?.abort();const own=++revision,user=auth.user?.id,session=auth.identityRevision;readController=new AbortController();state.loading=true;state.error='';
  try{const rows=await api.get('/extensions',{signal:readController.signal,retry:false});if(!current(user,session)||own!==revision)return;if(!Array.isArray(rows))throw Error('扩展列表暂时未能完整读取。');state.items=rows;const id=route.query.id;if(id!==undefined){const selected=typeof id==='string'?rows.find(row=>row.id===id):null;if(selected)await open(selected,{fromRoute:true});else{rejectOffer('这个扩展暂时不能继续交互。');state.selected=state.target=null;resetFrame();state.error='这个扩展已经移除或暂时不能使用，请重新选择。';}}}
  catch(error){if(current(user,session)&&own===revision&&error.name!=='AbortError')state.error=error.message||'扩展列表暂时不可用。';}finally{if(current(user,session)&&own===revision)state.loading=false;}
 }
 async function offerRequest(message){
  const cacheKey=message.id||'legacy:'+message.prompt,result=cache.offer(cacheKey,message.prompt),context=reactive({...message,id:message.id||'legacy',cacheKey,extensionId:state.selected.id,frameKey:state.frameKey,nonce,quote:null,quoteLoading:true,error:''});
  if(result.state==='conflict'){send('error',{id:context.id,error:'同一个请求的内容已经变化，请使用新的请求标识。'},context);return;}
  if(result.state==='done'){send(result.record.error?'error':'result',{id:context.id,text:result.record.text,error:result.record.error},context);return;}
  if(result.state==='pending'){send('ack',{id:context.id,phase:state.offer?'review':'running'},context);return;}
  if(result.state==='busy'||busy.value||state.offer||!rate('chat',20)){cache.finish(cacheKey,message.prompt,{error:'请先完成工作台里的当前请求。'});send('error',{id:context.id,error:'请先完成工作台里的当前请求。'},context);return;}
  if(!state.selected.chatEnabled){cache.finish(cacheKey,message.prompt,{error:'这个扩展暂未开放对话请求。'});send('error',{id:context.id,error:'这个扩展暂未开放对话请求。'},context);return;}
  if(state.operation)dismiss();state.offer=context;state.stage='review';state.reply='';state.operationError='';send('ack',{id:context.id,phase:'review'},context);
  try{const quote=await api.get('/extensions/'+context.extensionId+'/quote',{retry:false});if(!current()||state.offer!==context||context.frameKey!==state.frameKey||context.nonce!==nonce)return;if(quote.extensionVersion!==state.selected?.version)throw Error('扩展设定已经变化，请重新打开扩展后再试。');context.quote=quote;}catch(error){if(current()&&state.offer===context){context.error=error.message||'暂时无法核对本次模型与费用。';state.notice=context.error;cache.finish(context.cacheKey,context.prompt,{error:context.error});send('error',{id:context.id,error:context.error},context);state.offer=null;state.stage='idle';}}finally{if(current()&&state.offer===context)context.quoteLoading=false;}
 }
 function receive(event){
  if(!current()||!state.selected||!state.target)return;const message=readExtensionMessage(event,{frame:frameWindow(),target:state.target,nonce,legacy:state.selected.legacyBridge});if(!message)return;
  if(message.type==='ready'){initializeFrame();return;}if(!state.frameReady)return;
  if(message.type==='theme'){if(rate('theme',8)&&mode.value!==message.mode)theme.set(message.mode);return;}
  if(message.type==='draft'){saveExtensionDraft(owner,state.selected,message.draft);return;}
  if(message.type==='cancel'){if(state.offer?.id===message.id&&state.offer.frameKey===state.frameKey&&state.offer.nonce===nonce)rejectOffer();else if(state.operation?.id===message.id&&state.operation.frameKey===state.frameKey&&state.operation.nonce===nonce)void cancel();return;}
  void offerRequest(message);
 }
 function finishDelivery(op,error=''){
  if(!validOperation(op)||op.delivered)return;op.delivered=true;cache.finish(op.cacheKey,op.prompt,{text:error?'':state.reply,error});send(error?'error':'result',{id:op.id,text:state.reply,error},op);
 }
 function applyReceipt(op,receipt){
  if(!validOperation(op)||receipt?.requestKey!==op.requestKey)return false;if(receipt.extensionId&&receipt.extensionId!==op.extensionId)throw Error('请求回执与当前扩展不一致。');op.receipt=receipt;state.receipt=receipt;state.reply=typeof receipt.content==='string'?receipt.content.slice(0,200000):'';
  if(receipt.status==='COMPLETED'){state.stage='complete';state.operationError='';removeExtensionReceipt(owner);finishDelivery(op);return true;}
  if(receipt.status==='FAILED'||receipt.status==='ABORTED'){state.stage=receipt.status==='ABORTED'?'canceled':'failed';state.operationError=receipt.status==='ABORTED'?'这次生成已经停止，请核对已保存内容与费用回执。':'这次生成暂未完成，结果和费用请以当前回执为准。';removeExtensionReceipt(owner);finishDelivery(op,state.operationError);return true;}
  if(receipt.status==='ENDED'||receipt.status==='EXPIRED'){state.stage='ended';state.operationError='这次准备已经结束，可以重新发起请求。';removeExtensionReceipt(owner);finishDelivery(op,state.operationError);return true;}return false;
 }
 async function fetchReceipt(op){const result=await api.get('/extensions/requests/'+op.requestKey,{retry:false});if(validOperation(op))applyReceipt(op,result);return result;}
 async function observe(op,submit=false){
  if(!validOperation(op))return;transport?.abort();const own=++observer;state.stage='running';state.connection='';state.operationError='';send('ack',{id:op.id,phase:'running'},op);
  const active=()=>validOperation(op)&&own===observer;
  const handlers={isCurrent:active,onMeta(meta){if(!active()||meta.conversationId&&meta.conversationId!==op.receipt.conversationId)return;if(meta.messageId)op.messageId=meta.messageId;},onSnapshot(snapshot){if(active())state.reply=String(snapshot.content||'').slice(0,200000);},onDelta(text){if(active())state.reply=(state.reply+text).slice(0,200000);},onConnection(value){if(active())state.connection=value;},onError(){if(active())state.operationError='正在核对本次回复的最终状态。';}};
  try{
   transport=submit?streamChat({conversationId:op.receipt.conversationId,clientMsgId:op.requestKey,extensionRequestKey:op.requestKey,model:op.receipt.modelName,messages:[{role:'user',content:op.receipt.prompt}],stream:true},handlers):resumeChat(op.messageId||op.receipt.messageId,handlers);
   await transport.finished;if(!active())return;state.stage='checking';const receipt=await fetchReceipt(op);if(!active()||TERMINAL.includes(receipt.status)||['ENDED','EXPIRED'].includes(receipt.status))return;state.stage='unknown';state.operationError=receipt.status==='READY'?'尚未确认本次生成是否接受。可以继续核对，或用同一份请求继续。':'连接暂时中断，原请求仍可核对和继续接收。';
  }catch(error){if(active()){state.stage='unknown';state.operationError='请求结果尚未确认，请先核对原请求。';}}finally{if(active())transport=null;}
 }
 async function approve(){
  const offer=state.offer;if(!offer||offer.quoteLoading||!offer.quote||offer.error||!current())return;if(!state.frameReady||offer.frameKey!==state.frameKey||offer.nonce!==nonce){offer.error='画布连接已经变化，请重新打开扩展。';return;}
  const op=reactive({...offer,requestKey:crypto.randomUUID(),receipt:null,messageId:null,delivered:false});
  try{saveExtensionReceipt(owner,op);}catch(error){offer.error=error.message;return;}
   state.offer=null;state.operation=op;state.receipt=null;state.stage='preparing';state.reply='';state.operationError='';operationController?.abort();operationController=new AbortController();const preparation=++observer;
   try{const receipt=await api.post('/extensions/'+op.extensionId+'/requests',{requestKey:op.requestKey,prompt:op.prompt,quoteRevision:op.quote.revision},{signal:operationController.signal,retry:false});if(!validOperation(op)||preparation!==observer)return;if(applyReceipt(op,receipt))return;if(receipt.status==='READY')await observe(op,true);else if(ACTIVE.includes(receipt.status))await observe(op,false);else throw Error('请求回执暂时不完整。');}
   catch(error){if(validOperation(op)&&preparation===observer){state.stage='unknown';state.operationError=error.status&&error.status<500?error.message:'请求结果尚未确认，请先核对原请求。';}}
 }
 async function check({resume=true}={}){
  const op=state.operation;if(!op||!current()||['preparing','checking'].includes(state.stage))return;transport?.abort();observer++;state.stage='checking';state.operationError='';
  try{const receipt=await fetchReceipt(op);if(!validOperation(op)||TERMINAL.includes(receipt.status)||['ENDED','EXPIRED'].includes(receipt.status))return;if(ACTIVE.includes(receipt.status)&&resume)await observe(op,false);else{state.stage='unknown';state.operationError=receipt.status==='READY'?'这份请求已准备好。继续时仍使用同一份回执，不会创建重复提问。':'原请求仍在处理中，可以继续核对。';}}
  catch(error){if(validOperation(op)){state.stage='unknown';state.operationError=error.status===404?'暂未找到已接受的请求。可继续核对，或结束等待后重新发起。':'暂时无法核对，请稍后再试。';}}
 }
 async function retry(){const op=state.operation;if(!op||state.stage!=='unknown'||!op.receipt)return;if(op.receipt.status==='READY')await observe(op,true);else if(op.receipt.messageId)await observe(op,false);}
 async function cancel(){
   if(state.offer){rejectOffer();return;}const op=state.operation;if(!op||!current()||state.canceling)return;observer++;operationController?.abort();transport?.abort();state.canceling=true;state.stage='canceling';send('ack',{id:op.id,phase:'canceling'},op);
  try{const receipt=await fetchReceipt(op);if(!validOperation(op))return;if(applyReceipt(op,receipt))return;if(receipt.messageId){await api.post('/chat/runs/'+receipt.messageId+'/cancel',{}, {retry:false});if(validOperation(op))await observe(op,false);}else{const ended=await api.post('/extensions/requests/'+op.requestKey+'/end',{}, {retry:false});if(validOperation(op))applyReceipt(op,ended);}}
  catch(error){if(validOperation(op)){if(error.status===404){try{const ended=await api.post('/extensions/requests/'+op.requestKey+'/end',{}, {retry:false});if(validOperation(op))applyReceipt(op,ended);}catch{state.stage='unknown';state.operationError='尚未确认是否结束，请继续核对原请求。';}}else{state.stage='unknown';state.operationError='尚未确认是否停止，请继续核对原请求。';}}}finally{if(validOperation(op))state.canceling=false;}
 }
 function dismiss(){if(busy.value)return;state.operation=null;state.receipt=null;state.reply='';state.operationError='';state.stage=state.offer?'review':'idle';}
 async function recover(){const record=readExtensionReceipt(owner);if(!record||!current())return;const op=reactive({...record,id:'recovered',prompt:'',cacheKey:'recovered:'+record.requestKey,frameKey:-1,nonce:'',legacy:false,receipt:null,messageId:null,delivered:true});state.operation=op;state.stage='unknown';await check();}
 function dispose(){revision++;observer++;readController?.abort();operationController?.abort();transport?.abort();transport=null;clearTimeout(slowTimer);cache.clear();nonce='';state.offer=state.operation=state.receipt=state.selected=state.target=null;state.items=[];state.reply='';state.operationError='';state.stage='idle';state.frameReady=false;state.frameLoading=false;state.canceling=false;state.frameError='';state.frameSlow=false;state.maximized=false;}
 watch(mode,value=>{if(state.frameReady){send('theme',{mode:value});if(state.selected?.legacyBridge&&frameWindow())frameWindow().postMessage({type:'theme',data:value},state.target.targetOrigin);}});
 watch(()=>route.query.id,value=>{if(!current()||value===state.selected?.id)return;if(value===undefined){close({fromRoute:true});return;}const entry=state.items.find(row=>row.id===value);if(entry)void open(entry,{fromRoute:true});else{rejectOffer();state.selected=state.target=null;state.maximized=false;resetFrame();state.error='这个扩展已经移除或暂时不能使用，请重新选择。';}});
 onBeforeRouteUpdate(to=>{if(busy.value&&to.query.id!==route.query.id){state.notice='请先核对当前请求，再切换扩展。';return false;}});
 watch([()=>auth.user?.id,()=>auth.identityRevision,()=>auth.user?.role],async()=>{dispose();owner=auth.user?.id;identity=auth.identityRevision;state.notice='账号已变化，已清除原来的扩展内容。';if(current()){await load();await recover();}});
 onMounted(async()=>{window.addEventListener('message',receive);await load();if(current())await recover();});
 onBeforeUnmount(()=>{alive=false;window.removeEventListener('message',receive);dispose();});
 return{state,busy,historyTarget,load,open,close,reload,frameLoaded,frameFailed,approve,rejectOffer,check,retry,cancel,dismiss};
}
