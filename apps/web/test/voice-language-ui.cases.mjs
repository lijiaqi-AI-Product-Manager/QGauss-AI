import{voiceComposerFixtures}from'../../../scripts/preview/voice-composer-fixture.mjs';
import{voiceLibraryFixtures}from'../../../scripts/preview/voice-library-fixture.mjs';
import{voiceFixtures}from'../../../scripts/preview/voice-fixture.mjs';

export function registerVoiceLanguageTests({test,assert,mount,mountVoiceLibrary,settle,relayJson,setLang}){
 const wait=async predicate=>{for(let n=0;n<160;n++){if(predicate())return;await settle();}assert.ok(predicate(),'voice language view did not settle');};
 const click=text=>{const node=[...document.querySelectorAll('button')].find(row=>row.textContent.trim()===text||row.getAttribute('aria-label')===text);assert.ok(node,text);assert.equal(node.disabled,false);node.click();};
 const input=(selector,value)=>{const node=document.querySelector(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
 const choose=async value=>{setLang(value);await settle();};
 async function composer(extra,mode='voice-composer-ready'){
  const memory=voiceComposerFixtures(mode),f=await mount({loggedIn:true,initialPath:'/voice/create',intercept:async call=>await extra?.(call,memory)||memory.reply(new URL(call.url,'http://qgauss.test'),{method:call.method,body:call.body?JSON.stringify(call.body):undefined})});
  await wait(()=>document.querySelector('.qvs-writing'));return f;
 }
 const voiceWrites=f=>f.calls.filter(row=>row.method!=='GET'&&row.url.includes('/voice/'));

 test('声音语言：确认中的原文与新草稿分别保留，切换语言不重报费用或改变提交内容',async()=>{
  const f=await composer();try{
   const title='声音已就绪',text='保存完整配音 {p0} $& 是我自己的正文';input('.qvs-title-input input',title);input('.qvs-text-input textarea',text);await settle();click('让文字，慢慢响起来');await wait(()=>document.querySelector('.qvs-offer-price'));
   input('.qvs-text-input textarea','另一份尚未完成的草稿');const originalOffer=document.querySelector('.qvs-review'),choice=document.querySelector('.qvs-stream-choice input');choice.checked=false;choice.dispatchEvent(new Event('change',{bubbles:true}));await choose('en');
   assert.equal(document.querySelector('.qvs-review'),originalOffer);assert.equal(document.querySelector('.qvs-offer-text').textContent,text);assert.equal(document.querySelector('.qvs-title-input input').value,title);assert.match(document.querySelector('.qvs-offer-price').textContent,/Credits for this task: 2/);assert.equal(document.querySelector('.qvs-stream-choice input').checked,false);
   await choose('zh-TW');assert.equal(document.querySelector('.qvs-text-input textarea').value,'另一份尚未完成的草稿');assert.equal(document.querySelector('.qvs-offer-text').textContent,text);assert.equal(voiceWrites(f).filter(row=>row.url==='/api/voice/quote').length,1);await choose('en');click('Confirm and generate');await wait(()=>f.calls.some(row=>row.url==='/api/voice/tasks'));
   const created=f.calls.find(row=>row.url==='/api/voice/tasks');assert.equal(created.body.text,text);assert.equal(created.body.title,title);assert.equal(created.body.voice,'fable');assert.equal(voiceWrites(f).filter(row=>row.url==='/api/voice/tasks').length,1);assert.deepEqual(f.errors,[]);
  }finally{await f.close();setLang('zh');}
 });

 test('声音语言：生成中的播放与暂停在语言切换后继续使用同一音频地址和原任务',async()=>{
  const proto=window.HTMLMediaElement.prototype,oldPlay=proto.play;let plays=0;proto.play=function(){plays++;return Promise.resolve();};
  const f=await composer(async(call,memory)=>{
   if(call.method==='GET'&&/\/voice\/tasks\/[^/]+\/audio\/0$/.test(call.url))return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});
   if(/\/voice\/tasks(?:$|\/by-request\/)/.test(call.url)){const result=await memory.reply(new URL(call.url,'http://qgauss.test'),{method:call.method,body:call.body?JSON.stringify(call.body):undefined});if(result){const body=await result.json(),row=body.data??body;if(row.kind==='speech'&&row.status==='RUNNING'){row.streamUrl='/api/voice/tasks/'+row.id+'/stream';row.audio=[{index:0,url:'/api/voice/tasks/'+row.id+'/audio/0'}];row.segmentCount=2;row.completedSegments=1;}return relayJson(row);}}
  },'voice-composer-hold');
  try{input('.qvs-text-input textarea','一个正在被听见的原想法');await settle();click('让文字，慢慢响起来');await wait(()=>document.querySelector('.qvs-offer-price'));click('确认，开始生成');await wait(()=>document.querySelector('[aria-label="暂停这段配音"]'));const audio=document.querySelector('.qvs-session audio'),source=audio.getAttribute('src'),reads=f.calls.filter(row=>row.url.includes('/audio/')).length;assert.ok(source);await choose('en');assert.equal(document.querySelector('.qvs-session audio'),audio);assert.equal(audio.getAttribute('src'),source);assert.equal(plays,1);click('Pause this voiceover');await choose('zh-TW');assert.match(document.querySelector('.qvs-stream-status').textContent,/已暫停/);await choose('en');click('Play this voiceover');await wait(()=>plays===2);assert.equal(audio.getAttribute('src'),source);assert.equal(f.calls.filter(row=>row.url.includes('/audio/')).length,reads);assert.equal(voiceWrites(f).filter(row=>row.url==='/api/voice/tasks').length,1);assert.deepEqual(f.errors,[]);}finally{proto.play=oldPlay;await f.close();setLang('zh');}
 });

 test('声音语言：收藏中的用户标题与播放保留，界面同名词不会覆盖用户内容',async()=>{
  const data=voiceLibraryFixtures(),id='qg-library-voice-0',title='声音已就绪';data['/api/voice/library/'+id].label=title;data['/api/voice/library'].items.find(row=>row.id===id).label=title;const f=await mountVoiceLibrary(null,{data});
  try{await wait(()=>document.querySelector('.qvl-card-open'));document.querySelector('.qvl-card-open').click();await wait(()=>document.querySelector('.qvl-play'));click('播放这段声音');await wait(()=>document.querySelector('.qvl-detail audio').getAttribute('src'));const audio=document.querySelector('.qvl-detail audio'),source=audio.getAttribute('src'),calls=f.calls.length;await choose('en');assert.equal(document.querySelector('.qvl-detail h2').textContent,title);assert.equal(audio.getAttribute('src'),source);assert.match(document.querySelector('.qvl-detail').textContent,/Plays saved audio/);assert.equal(document.querySelector('.qvl-play').getAttribute('aria-label'),'Pause this sound');await choose('zh-TW');assert.equal(document.querySelector('.qvl-detail h2').textContent,title);assert.equal(audio.getAttribute('src'),source);assert.equal(f.calls.length,calls);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：历史转写、未提交搜索与清理确认在切换语言后保持原记录',async()=>{
  const data=voiceLibraryFixtures(),id='qg-library-voice-1',transcript='保存声音设置 {title} $&';data['/api/voice/library/'+id].transcript=transcript;const f=await mountVoiceLibrary(null,{data});
  try{await wait(()=>document.querySelectorAll('.qvl-card-open').length>1);document.querySelectorAll('.qvl-card-open')[1].click();await wait(()=>document.querySelector('.qvl-transcript textarea'));input('.qvl-search input','没有提交的搜索内容');click('清理这条记录');await choose('en');assert.equal(document.querySelector('.qvl-transcript textarea').value,transcript);assert.equal(document.querySelector('.qvl-search input').value,'没有提交的搜索内容');assert.match(document.querySelector('.qvl-dialog').textContent,/cannot be undone/);const label=document.querySelector('.qvl-dialog>p').textContent;await choose('zh-TW');assert.equal(document.querySelector('.qvl-dialog>p').textContent,label);assert.equal(document.querySelector('.qvl-transcript textarea').value,transcript);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：费用中的退回和过期分别显示，语言切换不触发退款或清理',async()=>{
  const data=voiceLibraryFixtures(),row=data['/api/voice/library/qg-library-voice-6'];row.billing={reserved:0,charged:0,returned:1,expired:2};const f=await mountVoiceLibrary(null,{data});
  try{await wait(()=>document.querySelectorAll('.qvl-card-open').length>6);document.querySelectorAll('.qvl-card-open')[6].click();await wait(()=>document.querySelector('.qvl-receipt'));await choose('en');const receipt=document.querySelector('.qvl-receipt').textContent;assert.match(receipt,/Returned 1 credit/);assert.match(receipt,/2 reserved credits expired/);assert.equal(receipt.includes('No site credits used'),false);await choose('zh-TW');assert.match(document.querySelector('.qvl-receipt').textContent,/已退回 1 次/);assert.match(document.querySelector('.qvl-receipt').textContent,/2 次已過期/);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：管理页未保存设置和版本保持不变，切换语言不保存或发起生成',async()=>{
  const data=voiceFixtures(),f=await mount({loggedIn:true,admin:true,initialPath:'/voice/manage',intercept:call=>Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});
  try{await wait(()=>document.querySelector('.qvc-config'));input('.qvc-billing-grid input','7');input('[aria-label="新声音作品保留天数"]','14');await choose('en');assert.equal(document.querySelector('.qvc-billing-grid input').value,'7');assert.equal(document.querySelector('[aria-label="Retention days for new sound creations"]').value,'14');assert.match(document.querySelector('.qvc-hero h1').textContent,/a voice with warmth/);assert.match(document.querySelector('.qvc-config').textContent,/tts-1/);await choose('zh-TW');assert.equal(document.querySelector('.qvc-billing-grid input').value,'7');assert.equal(document.querySelector('[aria-label="新聲音作品保留天數"]').value,'14');assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：未配置的服务原因随语言切换，原草稿仍可编辑且不生成',async()=>{
  const f=await composer(call=>call.url==='/api/voice/options'?relayJson({speech:{ready:false,reason:'站点尚未开启语音服务'},maxSpeechChars:16000}):null);
  try{input('.qvs-title-input input','保存完整配音');input('.qvs-text-input textarea','我自己的文字原样保留');await choose('en');assert.match(document.querySelector('.qvs-unavailable').textContent,/Voice is not enabled/);assert.equal(document.querySelector('.qvs-title-input input').value,'保存完整配音');await choose('zh-TW');assert.match(document.querySelector('.qvs-unavailable').textContent,/站點尚未開啟/);assert.equal(document.querySelector('.qvs-text-input textarea').value,'我自己的文字原样保留');assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：聊天试听的费用确认和音色保持稳定，切换语言与取消均不创建任务',async()=>{
  const data=voiceFixtures(),f=await mount({loggedIn:true,initialPath:'/chat?voice=voices',intercept:call=>call.url==='/api/voice/quote'?relayJson({kind:'speech',cost:2,pool:'model3',revision:'a'.repeat(64),segments:1}):Object.hasOwn(data,call.url)?relayJson(data[call.url]):null});
  try{await wait(()=>document.querySelector('.qvoice-voices-panel'));await choose('en');assert.match(document.querySelector('.qvoice-audition').textContent,/Credits for this task: 2/);click('Preview this voice ▷');await wait(()=>document.querySelector('.qvoice-confirm'));await choose('zh-TW');assert.match(document.querySelector('.qvoice-confirm').textContent,/本次 2 次/);await choose('en');click('Keep thinking');assert.equal(voiceWrites(f).filter(row=>row.url==='/api/voice/quote').length,1);assert.equal(voiceWrites(f).filter(row=>row.url==='/api/voice/tasks').length,0);assert.equal(voiceWrites(f)[0].body.voice,'fable');assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });

 test('声音语言：使用英文音色名搜索后切换繁体仍保留原查询和结果，不触发生成',async()=>{
  const f=await mountVoiceLibrary();try{await wait(()=>document.querySelector('.qvl-card-open'));await choose('en');input('.qvl-search input','Story');document.querySelector('.qvl-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait(()=>f.calls.some(row=>row.url.includes('q=Story'))&&document.querySelectorAll('.qvl-card-open').length===2);await choose('zh-TW');assert.equal(document.querySelector('.qvl-search input').value,'Story');assert.equal(document.querySelectorAll('.qvl-card-open').length,2);assert.equal(voiceWrites(f).length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();setLang('zh');}
 });
}
