(function(){
 'use strict';const bridge=window.QGaussBridge,idea=document.getElementById('idea'),ask=document.getElementById('ask'),status=document.getElementById('status'),count=document.getElementById('count');let tone='plan',ready=false,busy=false,mode='light',timer;
 const labels={plan:'请把下面这个想法整理成具体、可执行的小计划，保留轻松自然的语气：',ideas:'请围绕下面这个想法，给出五个有差异、有趣又可实践的创作方向：',words:'请把下面这个想法写成一段清楚、有画面感的文字，保留原来的意图：'};
 function controls(){ask.disabled=busy||!ready||!idea.value.trim();count.textContent=idea.value.length+' / 3000';}
 function save(){clearTimeout(timer);timer=setTimeout(()=>bridge.saveDraft(JSON.stringify({text:idea.value,tone})),200);controls();}
 function paintTone(){for(const button of document.querySelectorAll('[data-tone]'))button.setAttribute('aria-pressed',String(button.dataset.tone===tone));}
 bridge.onTheme(value=>{mode=value;document.documentElement.dataset.theme=value;});
 bridge.onDraft(value=>{try{const row=JSON.parse(value);if(typeof row?.text==='string'&&row.text.length<=3000){idea.value=row.text;if(Object.hasOwn(labels,row.tone))tone=row.tone;paintTone();controls();}}catch{}});
 bridge.onReady(value=>{ready=value.chat;status.textContent=ready?'对话请求会先在工作台确认，再开始生成。':'便签已经打开。创作搭档尚未接通时，也可以先保留想法。';controls();});
 document.getElementById('theme').addEventListener('click',()=>bridge.setTheme(mode==='dark'?'light':'dark'));
 idea.addEventListener('input',save);for(const button of document.querySelectorAll('[data-tone]'))button.addEventListener('click',()=>{tone=button.dataset.tone;paintTone();save();});
 ask.addEventListener('click',async()=>{if(busy||!ready||!idea.value.trim())return;busy=true;controls();status.textContent='请在工作台确认这次请求。';try{const answer=await bridge.requestChat(labels[tone]+'\n\n'+idea.value.trim(),{onProgress:phase=>{status.textContent=({review:'请在工作台确认问题和费用。',running:'创作搭档正在展开这个想法…',recovering:'正在核对原请求的回复…',canceling:'正在请求停止，请等待结果确认。'})[phase]||'正在等待回复…';}});document.getElementById('answer').textContent=answer;document.getElementById('answer-panel').hidden=false;status.textContent='新想法已接住，也已保存在你的对话记录中。';}catch(error){status.textContent=error.message||'本次请求暂未完成，请在工作台核对状态。';}finally{busy=false;controls();}});
 document.getElementById('copy').addEventListener('click',async()=>{const text=document.getElementById('answer').textContent;try{await navigator.clipboard.writeText(text);status.textContent='文字已复制。';}catch{status.textContent='当前窗口不支持直接复制，可以选中文字后复制。';}});
})();
