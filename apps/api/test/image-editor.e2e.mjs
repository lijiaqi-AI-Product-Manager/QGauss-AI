/** Private editor inputs use the isolated database and real HTTP file transport. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {PrismaClient} from '@prisma/client';
import sharp from 'sharp';
if(process.env.DATABASE_URL!=='file:./e2e.db'||!resolve(process.env.E2E_STORAGE_DIR||'.').startsWith(resolve(tmpdir())+sep+'qgauss-e2e-storage-'))throw Error('Editor requires isolated database and storage');
const db=new PrismaClient(),root=process.env.E2E_API,tag=randomUUID().replaceAll('-','').slice(0,12);
let admin='',owner='',other='',ownerId='',passed=0;
const values={'commerce.enabled':true,'demo.siteEnabled':false,'security.registerEnabled':true,'security.registerInviteCode':'','security.captchaEnabled':false,'security.emailVerificationRequired':false,'security.registerRateLimit':1000,'security.loginRateLimit':1000};
const original=await db.globalConfig.findMany({where:{key:{in:Object.keys(values)}}});
const check=(name,value)=>{assert.ok(value,name);passed++;console.log('  ✔ '+name);};
async function api(path,method='GET',body,token=owner){const response=await fetch(root+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const json=await response.json();return{status:response.status,data:json.data??json,response};}
const settings=data=>api('/settings','PUT',{settings:Object.entries(data).map(([key,value])=>({key,value}))},admin);
async function upload(bytes,mime='image/png',token=owner,name='QGauss 私人参考.png'){const body=new FormData();body.append('file',new Blob([bytes],{type:mime}),name);const response=await fetch(root+'/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(15000)});assert.equal(response.status,201);return(await response.json()).data.id;}
const inputs=(source,mask,token=owner,extra='')=>api('/image/editor/inputs?sourceId='+source+(mask?'&maskId='+mask:'')+extra,'GET',undefined,token);
const media=(id,token=owner)=>fetch(root+'/image/editor/files/'+id,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(15000)});
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
try{
 admin=(await api('/auth/login','POST',{account:process.env.E2E_ADMIN||'admin',password:process.env.E2E_PASSWORD||'admin123456'},'')).data.accessToken;assert.ok(admin);assert.equal((await settings(values)).status,200);
 for(const [index,kind]of ['owner','other'].entries()){const email='editor-'+kind+tag+'@qgauss.test',password='QGauss-editor-local-123';assert.equal((await api('/auth/register','POST',{email,username:'qgedit'+index+tag,password},'')).status,201);const signed=(await api('/auth/login','POST',{account:email,password},'')).data;if(index===0){owner=signed.accessToken;ownerId=signed.user.id;}else other=signed.accessToken;}
 const beforeBalance=(await api('/balance/query')).data,before={tasks:await db.imageTask.count({where:{userId:ownerId}}),usage:await db.usageRecord.count({where:{userId:ownerId}}),reservations:await db.countReservation.count({where:{userId:ownerId}})};
 const png=await sharp({create:{width:64,height:48,channels:4,background:'#ad97ed'}}).png().toBuffer(),rawMask=Buffer.alloc(64*48*4,255);for(let i=0;i<64*48;i++)if(i%64<32)rawMask[i*4+3]=0;
 const maskBytes=await sharp(rawMask,{raw:{width:64,height:48,channels:4}}).png().toBuffer(),source=await upload(png),mask=await upload(maskBytes),foreign=await upload(png,'image/png',other);
 check('图片与选区入口均要求登录',(await inputs(source,mask,'')).status===401&&(await media(source,'')).status===401);
 const prepared=await inputs(source,mask);assert.equal(prepared.status,200);assert.equal(prepared.data.source.width,64);assert.equal(prepared.data.source.height,48);assert.equal(prepared.data.mask.id,mask);
 check('带入的原图和选区通过真实上传与尺寸校验',prepared.data.source.id===source&&prepared.data.source.url==='/api/image/editor/files/'+source&&prepared.response.headers.get('cache-control')==='private, no-store');
 const serialized=JSON.stringify(prepared.data);check('响应只返回编辑所需信息',!['storedKey','sha256','userId','apiKey','storageDir'].some(key=>serialized.includes(key)));
 for(const token of [other,admin]){assert.equal((await inputs(source,mask,token)).status,404);const denied=await media(source,token);assert.equal(denied.status,404);await denied.arrayBuffer();}
 check('其他用户与管理员均不能通过编辑台读取他人图片',(await inputs(source,foreign)).status===404);
 for(const id of [source,mask]){const response=await media(id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('content-type'),'image/png');assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(id===source?png:maskBytes));}
 check('原图与透明选区读取保留完整字节，并禁止共享缓存',true);
 for(const path of ['/image/editor/inputs','/image/editor/inputs?sourceId='+source+'&sourceId='+source,'/image/editor/inputs?sourceId='+source+'&maskId='+mask+'&maskId='+mask,'/image/editor/inputs?sourceId=..%2Ffile'])assert.equal((await api(path)).status,400,path);
 assert.deepEqual((await inputs(source,mask,owner,'&unexpected=1')).data,prepared.data);
 check('缺失、重复和路径伪装被拒绝，额外参数不改变文件访问范围',true);
 const opaque=await upload(png),wrong=await upload(await sharp(maskBytes).resize(32,24).png().toBuffer()),broken=await upload(png.subarray(0,34));
 for(const [image,selection]of [[source,opaque],[source,wrong],[broken,null]])assert.equal((await inputs(image,selection)).status,400);
 check('不透明选区、尺寸冲突和损坏图片不会进入绘画草稿',true);
 const jpeg=await sharp(png).jpeg().withMetadata({orientation:6}).toBuffer(),rotated=await upload(jpeg,'image/jpeg'),rotatedMask=await upload(await sharp(maskBytes).rotate(90).png().toBuffer()),orientation=await inputs(rotated,rotatedMask);
 check('旋转照片按实际显示方向核对选区',orientation.status===200&&orientation.data.source.width===48&&orientation.data.source.height===64);
 const expired=await upload(png);await db.uploadFile.update({where:{id:expired},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await inputs(expired)).status,404);const expiredMedia=await media(expired);assert.equal(expiredMedia.status,404);await expiredMedia.arrayBuffer();
 check('过期图片不会被旧链接重新打开',true);
 assert.equal((await api('/upload/'+mask,'DELETE')).status,200);assert.equal((await inputs(source,mask)).status,404);const withdrawn=await media(mask);assert.equal(withdrawn.status,404);await withdrawn.arrayBuffer();
 check('选区移除后，旧带入记录和文件链接同时失效',true);
 assert.deepEqual((await api('/balance/query')).data,beforeBalance);assert.equal(await db.imageTask.count({where:{userId:ownerId}}),before.tasks);assert.equal(await db.usageRecord.count({where:{userId:ownerId}}),before.usage);assert.equal(await db.countReservation.count({where:{userId:ownerId}}),before.reservations);
 check('所有编辑准备和读取都未创建任务、预留或扣费',true);
}finally{if(admin)await settings(Object.fromEntries(original.map(row=>[row.key,JSON.parse(row.value)]))).catch(()=>{});await db.$disconnect();}
console.log('\n图像编辑台 HTTP：'+passed+' 通过 / 0 失败');
