/** Isolated extension presentation data. No project API or provider is contacted. */
export function extensionFixtures(state='extensions-workbench'){
 const builtin={id:'qgauss-idea-canvas',title:'QGauss 灵感便签',description:'把一个小念头放进画布，让创作搭档帮你展开。',entryUrl:'/extensions/idea-canvas.html',icon:'mindmap',tone:'violet',sort:0,enabled:true,roles:'USER,ADMIN',chatEnabled:true,legacyBridge:false,modelId:null,version:1,builtin:true,archived:false,lastRequestKey:null};
 const items=[builtin,...[
  ['d79b5389-e19b-4054-8dcc-85822ec116c5','QGauss 文字小屋','为文案和故事，腾出一间明亮的小屋。','chat','peach','words'],
  ['ad227f24-b907-4ab7-a865-964c3f2b2d42','QGauss 灵感拼图','拼起零散的线索，找到新的创作方向。','palette','lime','ideas'],
  ['ad1c975a-d608-4d16-bd3d-c93a537979e6','QGauss 画面收集盒','把喜欢的色彩与画面，放在同一片天空下。','image','sky','pictures'],
 ].map(([id,title,description,icon,tone,path],i)=>({...builtin,id,title,description,icon,tone,entryUrl:'https://tools.qgauss.test/'+path,sort:i+1,builtin:false}))],requests=new Map();let dropped=false;
 const model={id:'qg-extension-model',name:'qgauss-extension-preview',displayName:'QGauss 创作搭档',vendor:'QGauss',ready:true,capabilities:['chat'],billing:{mode:'count',pool:'model3',amount:2}};
 const json=(data,status=200)=>new Response(JSON.stringify(status<400?{code:0,data}:{code:status,message:data}),{status,headers:{'Content-Type':'application/json','X-QGauss-Reference-Fixture':'client-preview'}});
 const receipt=row=>({...row,content:row.content||'',billing:row.messageId?{state:row.status==='COMPLETED'?'SETTLED':'RESERVED',pool:'model3',charged:row.status==='COMPLETED'?2:0,returned:row.status==='ABORTED'?2:0,reserved:['PENDING','STREAMING'].includes(row.status)?2:0}:null});
 const response='一个小想法，可以这样慢慢展开：\n\n1. 先写下你最想得到的感受，挑出一个最小的目标。\n2. 给它留出一段不被打扰的时间，做一个轻巧的小尝试。\n3. 结束时记下一件喜欢的事，把下一步留给明天。\n\n不必一次做完，让想法先有一个开始。';
 return{async reply(url,init={}){
  const method=init.method||'GET',body=typeof init.body==='string'?JSON.parse(init.body):{},path=url.pathname;
  if(path==='/api/models/available')return json([model]);
  if(path==='/api/extensions/admin'&&method==='GET')return json({items,models:[{id:model.id,name:model.displayName}]});
  const admin=/^\/api\/extensions\/admin\/([^/]+)(?:\/(archive|restore))?$/.exec(path);
  if(admin&&['PUT','POST'].includes(method)){let row=items.find(item=>item.id===admin[1]);if(row?.lastRequestKey===body.requestKey)return json(row);if((row?.version||0)!==body.expectedVersion)return json('扩展设定已经变化，请重新读取。',409);if(!row){row={id:admin[1],version:0,builtin:false,archived:false};items.push(row);}if(admin[2])row.archived=admin[2]==='archive';else Object.assign(row,body);row.version++;row.lastRequestKey=body.requestKey;return json(row);}
  if(path==='/api/extensions')return json(state==='extensions-empty'?[]:items.filter(item=>!item.archived&&item.enabled));
  const prepared=/^\/api\/extensions\/([^/]+)\/requests$/.exec(path);
  if(prepared&&method==='POST'){let row=requests.get(body.requestKey);if(!row){const entry=items.find(item=>item.id===prepared[1]);row={requestKey:body.requestKey,extensionId:prepared[1],extensionVersion:entry.version,extensionTitle:entry.title,conversationId:'qg-extension-conversation-'+body.requestKey,prompt:body.prompt,modelName:model.name,status:'READY',messageId:null,content:'',expiresAt:new Date(Date.now()+1800000).toISOString()};requests.set(body.requestKey,row);}if(state==='extensions-prepare-unknown'&&!dropped){dropped=true;throw new TypeError('Local observation interrupted');}return json(receipt(row),201);}
  const request=/^\/api\/extensions\/requests\/([^/]+)(?:\/(end))?$/.exec(path);
  if(request){let row=requests.get(request[1]);if(request[2]&&method==='POST'){if(row?.messageId)return json('请求已经接受，请先核对回复。',409);if(!row){row={requestKey:request[1],extensionId:null,extensionVersion:0,extensionTitle:'扩展请求',conversationId:null,prompt:'',modelName:'',messageId:null,content:'',expiresAt:new Date().toISOString()};requests.set(request[1],row);}row.status='ENDED';}return row?json(receipt(row)):json('当前示例请求暂时不存在。',404);}
  const quote=/^\/api\/extensions\/([^/]+)\/quote$/.exec(path);
  if(quote){if(state==='extensions-unavailable')return json('当前模型尚未接通，便签仍可继续编辑。',400);const entry=items.find(item=>item.id===quote[1]);return entry?json({revision:'a'.repeat(64),extensionVersion:entry.version,modelId:model.id,modelName:model.displayName,cost:2,pool:'model3',demoMode:false}):json('这个扩展暂时不可用。',404);}
  if(path==='/api/chat/completions'&&method==='POST'&&body.extensionRequestKey){const row=requests.get(body.extensionRequestKey);if(!row)return json('请先确认扩展请求。',400);row.messageId='qg-extension-reply-'+row.requestKey;row.status='COMPLETED';row.content=response;const events=[['meta',{conversationId:row.conversationId,messageId:row.messageId,status:'STREAMING'}],['delta',{v:response}],['done',{status:'COMPLETED',messageId:row.messageId}]],encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){events.forEach(([name,data],index)=>controller.enqueue(encoder.encode('id: '+(index+1)+'\nevent: '+name+'\ndata: '+JSON.stringify(data)+'\n\n')));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
  const conversation=/^\/api\/conversations\/([^/]+)$/.exec(path);
  if(conversation){const row=[...requests.values()].find(item=>item.conversationId===conversation[1]);if(row)return json({id:row.conversationId,title:'扩展 · '+row.extensionTitle,model,app:null,agent:null,messages:row.messageId?[{id:'question-'+row.requestKey,role:'USER',status:'COMPLETED',content:row.prompt,parentId:null,createdAt:new Date().toISOString()},{id:row.messageId,role:'ASSISTANT',status:row.status,content:row.content,parentId:'question-'+row.requestKey,modelName:model.name,billing:receipt(row).billing,createdAt:new Date().toISOString()}]:[]});}
  return null;
 }};
}
