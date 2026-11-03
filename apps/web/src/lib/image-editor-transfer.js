const PREFIX='qg:image-editor:handoff:',MAX_AGE=30*60*1000,ID=/^[A-Za-z0-9_-]{1,128}$/;
const identifier=value=>typeof value==='string'&&ID.test(value);
const key=(owner,id)=>PREFIX+owner+':'+id;
function paintingDraft(value){
 if(value==null)return null;
 const fields={};for(const name of ['prompt','negativePrompt','model','ratio','resolution','quality','catId']){const item=value[name]??'';if(typeof item!=='string'||item.length>(name==='prompt'?4000:name==='negativePrompt'?2000:128))throw Error('绘画草稿不完整，请先检查填写的内容。');fields[name]=item;}
 if(!Array.isArray(value.references)||value.references.length<1||value.references.length>8||new Set(value.references.map(row=>row?.id)).size!==value.references.length||!value.references.every(row=>identifier(row?.id)&&typeof row.name==='string'&&row.name.length<=255))throw Error('绘画参考图记录不完整。');
 if(!Number.isInteger(value.n)||value.n<1||value.n>4||value.seed!==undefined&&value.seed!==null&&value.seed!==''&&(!Number.isInteger(value.seed)||value.seed<0||value.seed>4294967295))throw Error('请先检查绘画数量和种子设置。');
 const origin=value.editOrigin;if(origin!=null&&(!identifier(origin.taskId)||!identifier(origin.fileId)))throw Error('原作品记录不完整。');
 return{...fields,n:value.n,...(Number.isInteger(value.seed)?{seed:value.seed}:{}),references:value.references.map(row=>({id:row.id,name:row.name})),editOrigin:origin?{taskId:origin.taskId,fileId:origin.fileId}:null};
}
function checked(value,owner){
 if(!value||value.version!==1||value.owner!==owner||!identifier(value.id)||!identifier(value.sourceId)||value.maskId!==null&&!identifier(value.maskId)||typeof value.prompt!=='string'||value.prompt.length>4000||!Number.isSafeInteger(value.createdAt)||value.createdAt>Date.now()+60000||Date.now()-value.createdAt>MAX_AGE)throw Error('这份重绘设定已过期或不完整，请回到图像编辑台重新带入。');
 const draft=paintingDraft(value.returnDraft);if(draft&&draft.references[0].id!==value.sourceId)throw Error('重绘原图与绘画草稿不一致。');
 return{version:1,id:value.id,owner,sourceId:value.sourceId,maskId:value.maskId,prompt:value.prompt,returnDraft:draft,createdAt:value.createdAt};
}
export function saveImageEditorTransfer(owner,input,storage=sessionStorage){
 if(!identifier(owner))throw Error('请先登录后再带入绘画。');
 const record=checked({version:1,id:crypto.randomUUID(),owner,sourceId:input.sourceId,maskId:input.maskId||null,prompt:input.prompt||'',returnDraft:input.returnDraft||null,createdAt:Date.now()},owner);
 try{storage.setItem(key(owner,record.id),JSON.stringify(record));storage.setItem(key(owner,'latest'),record.id);}catch{throw Error('当前浏览器未能保留这份设定，请允许当前站点的临时存储后再试。');}return record;
}
export function readImageEditorTransfer(owner,id,storage=sessionStorage){
 if(!identifier(owner)||!identifier(id))throw Error('重绘设定标识无效。');let value;try{value=JSON.parse(storage.getItem(key(owner,id))||'null');}catch{throw Error('重绘设定暂时无法读取，请回到图像编辑台重新带入。');}return checked(value,owner);
}
export function latestImageEditorTransfer(owner,storage=sessionStorage){if(!identifier(owner))return null;try{const id=storage.getItem(key(owner,'latest'));return identifier(id)?id:null;}catch{return null;}}
export function removeImageEditorTransfer(owner,id,storage=sessionStorage){if(identifier(owner)&&identifier(id))try{storage.removeItem(key(owner,id));if(storage.getItem(key(owner,'latest'))===id)storage.removeItem(key(owner,'latest'));}catch{}}
export function clearImageEditorTransfers(owner,storage=sessionStorage){if(!identifier(owner))return;try{for(const name of Object.keys(storage))if(name.startsWith(PREFIX+owner+':'))storage.removeItem(name);}catch{}}
