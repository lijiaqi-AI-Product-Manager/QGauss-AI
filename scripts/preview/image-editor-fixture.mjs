/** Local file bytes stay inside this preview document; no project API is contacted. */
export function imageEditorPreview(){
 const files=new Map();let serial=0;
 const json=(data,status=200)=>new Response(JSON.stringify(status===200?{code:0,data}:{code:status,message:data}),{status,headers:{'Content-Type':'application/json','X-QGauss-Reference-Fixture':'client-preview'}});
 const features={qualities:['auto','low','medium','high'],resolutions:['1K','2K','4K'],ratios:['1:1','3:4','16:9'],seed:false,pixelSize:true,maxReferences:8,mask:true};
 return{
  features,
  async reply(url,init={}){
   if(url.pathname==='/api/upload'&&(init.method||'GET')==='POST'){
    const file=init.body?.get?.('file');if(!file)return json('请选择本地观察图片。',400);const bitmap=await createImageBitmap(file),id='qg-editor-file-'+(++serial),entry={id,name:file.name,mime:file.type,width:bitmap.width,height:bitmap.height,blob:file};bitmap.close();files.set(id,entry);return json({id,filename:file.name,mime:file.type,size:file.size,url:'/api/image/editor/files/'+id});
   }
   if(url.pathname==='/api/image/editor/inputs'){
    const source=files.get(url.searchParams.get('sourceId')),maskId=url.searchParams.get('maskId'),mask=maskId?files.get(maskId):null;if(!source||maskId&&!mask)return json('本地示例记录已清除，请重新打开图片。',404);
    const record=entry=>({id:entry.id,name:entry.name,mime:entry.mime,width:entry.width,height:entry.height,url:'/api/image/editor/files/'+entry.id});return json({version:1,source:record(source),mask:mask?record(mask):null});
   }
   if(url.pathname.startsWith('/api/image/editor/files/')||/^\/api\/upload\/[^/]+\/raw$/.test(url.pathname)){const entry=files.get(url.pathname.startsWith('/api/upload/')?url.pathname.split('/').at(-2):url.pathname.split('/').at(-1));return entry?new Response(entry.blob,{headers:{'Content-Type':entry.mime,'Cache-Control':'private, no-store'}}):json('本地图片暂不可用。',404);}
   if(url.pathname==='/api/image/tasks'&&(init.method||'GET')==='POST')return json('当前为本地视觉样例，请在隔离接口验收中验证生成。',501);
   return null;
  }
 };
}
