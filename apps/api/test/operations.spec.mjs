/** Real encrypted bundles, SQLite, independent processes and restored HTTP application. */
import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import leases from '../prisma/data-lease.cjs';
import { createEncryptedBackup, verifyEncryptedBackup, restoreEncryptedBackup, recoverAdministrator, inspectLocalDatabase } from '../scripts/operations/operations.mjs';
import { generateBackupKey, portablePath, validateManifest } from '../scripts/operations/archive.mjs';
import { SecretBox } from '../dist/common/crypto/secret-box.js';
import { PrismaService } from '../dist/common/prisma/prisma.service.js';

const here=dirname(fileURLToPath(import.meta.url)),apiRoot=resolve(here,'..'),folder=mkdtempSync(join(tmpdir(),'qgauss-operations-')),base=join(folder,'base.db'),clients=[],children=[];
execFileSync(process.execPath,[join(apiRoot,'prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
const password='SyntheticAdminPass-819',newPassword='RestoredAdminPass-734';
const require=createRequire(import.meta.url);
after(async()=>{for(const child of children){if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}await Promise.all(clients.map(client=>client.$disconnect()));if(!resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-operations-'))throw Error('cleanup escaped');rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
async function fixture() {
  const root=join(folder,randomUUID());await mkdir(root);const database=join(root,'source.db');copyFileSync(base,database);
  const prisma=new PrismaClient({datasources:{db:{url:'file:'+database.replace(/\\/g,'/')}}});clients.push(prisma);
  const user=await prisma.user.create({data:{email:'owner@qgauss.test',username:'synthetic_owner',passwordHash:await bcrypt.hash(password,4),role:'ADMIN'}});
  await prisma.globalConfig.create({data:{key:'installation.state',value:'{"version":1,"phase":"legacy"}'}});
  const conversation=await prisma.conversation.create({data:{userId:user.id,title:'QGauss restored history',messages:{create:{role:'USER',content:'Synthetic persisted idea'}}}});
  const storage=join(root,'files');await mkdir(join(storage,'2026/11'),{recursive:true});const contents=Buffer.from('QGauss private synthetic attachment'),storedKey='2026/11/attachment.txt';await writeFile(join(storage,storedKey),contents);
  const upload=await prisma.uploadFile.create({data:{userId:user.id,storedKey,filename:'合成附件.txt',mime:'text/plain',size:contents.length,sha256:createHash('sha256').update(contents).digest('hex')}});
  const env={NODE_ENV:'test',JWT_SECRET:randomBytes(48).toString('base64url'),APP_ENCRYPTION_KEY:randomBytes(32).toString('base64'),DATABASE_URL:'file:'+database.replace(/\\/g,'/'),STORAGE_DRIVER:'local',STORAGE_DIR:storage,MAIL_SMTP_HOST:'',TRUST_PROXY:'false'};
  const box=new SecretBox(env.APP_ENCRYPTION_KEY),channel=await prisma.channel.create({data:{name:'synthetic encrypted',type:'MOCK',baseUrl:'mock://operations',apiKeyEnc:box.encrypt('synthetic-channel-secret')}});
  await prisma.channelKey.create({data:{channelId:channel.id,keyEnc:box.encrypt('synthetic-pool-secret'),keyHash:createHash('sha256').update('synthetic-pool-secret').digest('hex'),last4:'cret'}});
  await prisma.agentConnection.create({data:{name:'QGauss synthetic agent',baseUrl:'https://api.qgauss.test',authMode:'PAT',secretEnc:box.encrypt('synthetic-agent-secret')}});
  const envFile=join(root,'source.env'),keyFile=join(root,'backup.key'),output=join(root,'snapshot.qgb');await writeFile(envFile,Object.entries(env).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n');await generateBackupKey(keyFile);
  const options={database,storage,envFile,keyFile,output};return{root,prisma,user,conversation,upload,contents,env,options};
}

test('加密备份同时保存数据库、附件和运行配置；验证不改变原数据',async()=>{
  const f=await fixture(),before=await f.prisma.user.findUnique({where:{id:f.user.id}}),result=await createEncryptedBackup(f.options);
  assert.equal(result.summary.channelKeysChecked,3);assert.equal(result.summary.uploads,1);
  const bytes=await readFile(f.options.output);for(const value of [f.env.JWT_SECRET,'synthetic-channel-secret','owner@qgauss.test',f.contents.toString()])assert.equal(bytes.includes(Buffer.from(value)),false);
  const verified=await verifyEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile});assert.equal(verified.id,result.id);assert.equal(verified.verified,true);
  assert.deepEqual(await f.prisma.user.findUnique({where:{id:f.user.id}}),before);assert.equal((await readdir(f.root)).some(path=>path.startsWith('.qgauss-ops-')),false);
});

test('恢复到新目录保留原始配置、附件字节、账户、会话与私有渠道密钥',async()=>{
  const f=await fixture();await createEncryptedBackup(f.options);const destination=join(f.root,'restored');const result=await restoreEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile,destination});
  assert.equal(result.automaticStartup,false);assert.deepEqual(await readFile(join(destination,'bundle/environment/original.env')),await readFile(f.options.envFile));assert.deepEqual(await readFile(join(destination,'bundle/storage/2026/11/attachment.txt')),f.contents);
  const restored=new PrismaClient({datasources:{db:{url:'file:'+join(destination,'bundle/database/qgauss.db').replace(/\\/g,'/')}}});clients.push(restored);
  assert.equal((await restored.user.findUnique({where:{id:f.user.id}})).passwordHash,f.user.passwordHash);assert.equal((await restored.conversation.findUnique({where:{id:f.conversation.id}})).title,'QGauss restored history');assert.equal(new SecretBox(f.env.APP_ENCRYPTION_KEY).decrypt((await restored.channel.findFirst()).apiKeyEnc),'synthetic-channel-secret');
  assert.equal(new SecretBox(f.env.APP_ENCRYPTION_KEY).decrypt((await restored.agentConnection.findFirst()).secretEnc),'synthetic-agent-secret');
});

test('WAL 中尚未 checkpoint 的最新提交也进入一致性备份',async()=>{
  const f=await fixture();await f.prisma.$disconnect();const source=new DatabaseSync(f.options.database);source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE users SET displayName='latest committed WAL name';");
  try{
    await createEncryptedBackup(f.options);const destination=join(f.root,'wal-drill');await restoreEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile,destination});
    const restored=new DatabaseSync(join(destination,'bundle/database/qgauss.db'),{readOnly:true});try{assert.equal(restored.prepare('SELECT displayName FROM users').get().displayName,'latest committed WAL name');}finally{restored.close();}
  }finally{source.close();}
});

test('错误密钥、截断与篡改备份不会发布恢复目录，临时内容被清理',async()=>{
  const f=await fixture();await createEncryptedBackup(f.options);const wrong=join(f.root,'wrong.key');await generateBackupKey(wrong);const destination=join(f.root,'rejected');
  await assert.rejects(()=>restoreEncryptedBackup({input:f.options.output,keyFile:wrong,destination}),/认证失败/);
  const original=await readFile(f.options.output),tampered=join(f.root,'tampered.qgb');const altered=Buffer.from(original);altered[altered.length-20]^=1;await writeFile(tampered,altered);
  await assert.rejects(()=>restoreEncryptedBackup({input:tampered,keyFile:f.options.keyFile,destination}),/认证失败/);
  await writeFile(tampered,original.subarray(0,original.length-13));await assert.rejects(()=>restoreEncryptedBackup({input:tampered,keyFile:f.options.keyFile,destination}),/认证失败/);
  assert.equal((await readdir(f.root)).includes('rejected'),false);assert.equal((await readdir(f.root)).some(path=>path.startsWith('.qgauss-ops-')),false);
});

test('现有备份、密钥和恢复目录均不覆盖；归档拒绝越界与跨平台危险路径',async()=>{
  const f=await fixture();await createEncryptedBackup(f.options);const before=await readFile(f.options.output);await assert.rejects(()=>createEncryptedBackup(f.options),/目标已经存在/);assert.deepEqual(await readFile(f.options.output),before);
  const key=await readFile(f.options.keyFile);await assert.rejects(()=>generateBackupKey(f.options.keyFile));assert.deepEqual(await readFile(f.options.keyFile),key);
  const destination=join(f.root,'existing');await mkdir(destination);await writeFile(join(destination,'sentinel'),'keep');await assert.rejects(()=>restoreEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile,destination}),/目标已经存在/);assert.equal(await readFile(join(destination,'sentinel'),'utf8'),'keep');
  for(const path of ['../source.env','/absolute','storage/../../escape','storage/a\\b','storage/CON.txt','storage/x.','storage/a:b'])assert.equal(portablePath(path),false,path);
  assert.throws(()=>validateManifest({format:'QGauss AI Backup',version:1,id:'fixture',files:[{path:'database/qgauss.db',bytes:1,sha256:'a'.repeat(64)},{path:'environment/original.env',bytes:1,sha256:'b'.repeat(64)},{path:'storage/FILE',bytes:1,sha256:'c'.repeat(64)},{path:'storage/file',bytes:1,sha256:'d'.repeat(64)}]}),/重复/);
});

test('缺失附件、错误内容、远程存储或不匹配的应用密钥不能产生成功备份',async()=>{
  for(const scenario of ['missing','changed','s3','key']){
    const f=await fixture();if(scenario==='missing')await unlink(join(f.options.storage,'2026/11/attachment.txt'));if(scenario==='changed')await writeFile(join(f.options.storage,'2026/11/attachment.txt'),'modified');if(scenario==='s3')await f.prisma.uploadFile.update({where:{id:f.upload.id},data:{backend:'s3'}});if(scenario==='key')await writeFile(f.options.envFile,Object.entries({...f.env,APP_ENCRYPTION_KEY:randomBytes(32).toString('base64')}).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n'));
    await assert.rejects(()=>createEncryptedBackup(f.options));assert.equal((await readdir(f.root)).includes('snapshot.qgb'),false);
  }
});

test('从未上传文件的新站点也可备份恢复为空存储，不创建或修改源目录',async()=>{
  const f=await fixture();await f.prisma.uploadFile.deleteMany();const missing=join(f.root,'no-files-yet');const options={...f.options,storage:missing};
  const result=await createEncryptedBackup(options);assert.equal(result.summary.uploads,0);assert.equal(result.verified,true);
  assert.equal((await readdir(f.root)).includes('no-files-yet'),false);
  const destination=join(f.root,'empty-drill');await restoreEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile,destination});assert.deepEqual(await readdir(join(destination,'bundle/storage')),[]);
});

test('独立进程持有数据时拒绝备份和迁移；强制结束后自动释放，不留下永久占用', {timeout:15000},async()=>{
  const f=await fixture(),module=join(apiRoot,'prisma/data-lease.cjs');const child=spawn(process.execPath,['-e',`require(${JSON.stringify(module)}).acquireDataLease(process.argv[1]);console.log('locked');setInterval(()=>{},1000)`,f.options.database],{stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);
  await once(child.stdout,'data');await assert.rejects(()=>createEncryptedBackup(f.options),/数据已被/);
  assert.throws(()=>execFileSync(process.execPath,[join(apiRoot,'prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:f.options.database},stdio:'pipe'}));
  child.kill('SIGKILL');await once(child,'exit');assert.ok((await createEncryptedBackup(f.options)).id);
});

test('真实 Prisma 生命周期与维护操作互斥，正常关闭后可以备份',async()=>{
  const f=await fixture(),service=new PrismaService({datasources:{db:{url:f.env.DATABASE_URL}}}),previous=process.env.DATABASE_URL;process.env.DATABASE_URL=f.env.DATABASE_URL;
  try{await service.onModuleInit();await assert.rejects(()=>createEncryptedBackup(f.options),/数据已被/);}finally{await service.onApplicationShutdown();if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
  assert.ok((await createEncryptedBackup(f.options)).id);
});

test('完整 seed 命令也遵守数据互斥，不会在备份或服务期间写入',async()=>{
  const f=await fixture(),lease=leases.acquireDataLease(f.options.database),seed=[require.resolve('ts-node/dist/bin.js'),join(apiRoot,'prisma/seed.ts')],env={...process.env,...f.env,SEED_ADMIN_EMAIL:f.user.email,SEED_ADMIN_USERNAME:f.user.username,SEED_ADMIN_PASSWORD:password};
  try{assert.throws(()=>execFileSync(process.execPath,seed,{cwd:apiRoot,env,stdio:'pipe'}));}finally{lease.close();}
  assert.equal(await f.prisma.channel.count(),1);
  execFileSync(process.execPath,seed,{cwd:apiRoot,env,stdio:'pipe'});assert.equal((await f.prisma.user.findUnique({where:{id:f.user.id}})).passwordHash,f.user.passwordHash);assert.ok(await f.prisma.channel.count()>1);
});

test('管理员恢复先产生可验证备份，再原子更换密码、撤销登录与重置链接，并留下私有审计',async()=>{
  const f=await fixture(),passwordFile=join(f.root,'password.private');await writeFile(passwordFile,newPassword+'\n');
  await f.prisma.refreshToken.create({data:{userId:f.user.id,familyId:'synthetic-family',tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});await f.prisma.passwordReset.create({data:{userId:f.user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
  const result=await recoverAdministrator({...f.options,userId:f.user.id,passwordFile});assert.equal(result.recovered,true);assert.equal(result.revokedSessions,1);assert.equal(result.invalidatedResetLinks,1);assert.equal((await verifyEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile})).id,result.backupId);
  const user=await f.prisma.user.findUnique({where:{id:f.user.id}});assert.equal(user.tokenVersion,1);assert.equal(await bcrypt.compare(newPassword,user.passwordHash),true);assert.equal(await bcrypt.compare(password,user.passwordHash),false);
  assert.ok((await f.prisma.refreshToken.findFirst()).revokedAt);assert.ok((await f.prisma.passwordReset.findFirst()).usedAt);assert.ok(await f.prisma.globalConfig.findUnique({where:{key:'operations.adminRecovery.'+result.recoveryId}}));assert.equal((await f.prisma.globalConfig.findUnique({where:{key:'installation.state'}})).value,'{"version":1,"phase":"legacy"}');
});

test('锁定账户前可离线定位既有管理员，检查结果不暴露邮箱、密码或私有配置',async()=>{
  const f=await fixture(),result=await inspectLocalDatabase({database:f.options.database});
  assert.equal(result.integrity,'ok');assert.equal(result.administrators[0].id,f.user.id);assert.equal(result.administrators[0].recoveryAllowed,true);assert.equal(result.administrators[0].mailbox,'o***@qgauss.test');assert.equal(result.environmentChecked,false);
  assert.doesNotMatch(JSON.stringify(result),/owner@|password|JWT_SECRET|synthetic-channel-secret/);
});

test('普通成员不会提升，已删除管理员不恢复，停用管理员需要明确恢复选项',async()=>{
  for(const scenario of ['member','deleted','disabled']){
    const f=await fixture(),passwordFile=join(f.root,'password.private');await writeFile(passwordFile,newPassword);await f.prisma.user.update({where:{id:f.user.id},data:scenario==='member'?{role:'USER'}:scenario==='deleted'?{deletedAt:new Date()}:{status:'DISABLED'}});
    await assert.rejects(()=>recoverAdministrator({...f.options,userId:f.user.id,passwordFile}),/只能恢复/);
    if(scenario==='disabled'){const result=await recoverAdministrator({...f.options,userId:f.user.id,passwordFile,reactivate:true});assert.equal(result.reactivated,true);assert.equal((await f.prisma.user.findUnique({where:{id:f.user.id}})).status,'ACTIVE');}
    else assert.equal((await readdir(f.root)).includes('snapshot.qgb'),false);
  }
});

test('弱密码、备份失败或审计写入失败都不会部分更换管理员凭据',async()=>{
  const f=await fixture(),passwordFile=join(f.root,'password.private');await writeFile(passwordFile,'admin123456');await assert.rejects(()=>recoverAdministrator({...f.options,userId:f.user.id,passwordFile}));
  await writeFile(passwordFile,newPassword);const db=new DatabaseSync(f.options.database);db.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON global_configs WHEN NEW.key LIKE 'operations.adminRecovery.%' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");db.close();
  await assert.rejects(()=>recoverAdministrator({...f.options,userId:f.user.id,passwordFile}),/synthetic audit failure/);
  const user=await f.prisma.user.findUnique({where:{id:f.user.id}});assert.equal(user.passwordHash,f.user.passwordHash);assert.equal(user.tokenVersion,0);assert.equal((await verifyEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile})).verified,true);
});

test('恢复副本可启动真实 API，原账户可登录、历史可读、附件可下载且初始化仍关闭',{timeout:45000},async()=>{
  const f=await fixture();await createEncryptedBackup(f.options);const destination=join(f.root,'drill');await restoreEncryptedBackup({input:f.options.output,keyFile:f.options.keyFile,destination});
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const child=spawn(process.execPath,[join(apiRoot,'dist/main.js')],{cwd:apiRoot,env:{...process.env,...f.env,PORT:String(port),DATABASE_URL:'file:'+join(destination,'bundle/database/qgauss.db').replace(/\\/g,'/'),STORAGE_DIR:join(destination,'bundle/storage'),MAIL_SMTP_HOST:''},stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const base='http://127.0.0.1:'+port+'/api';let ready=false;
  try{
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw Error('restored application exited: '+output.slice(-1500));try{ready=(await fetch(base+'/health',{signal:AbortSignal.timeout(600)})).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,70));}assert.equal(ready,true,output.slice(-1500));
    const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'synthetic_owner',password})});assert.equal(login.status,201);const data=(await login.json()).data,headers={authorization:'Bearer '+data.accessToken};
    assert.equal((await(await fetch(base+'/users/profile',{headers})).json()).data.id,f.user.id);assert.equal((await(await fetch(base+'/conversations',{headers})).json()).data.some(row=>row.id===f.conversation.id),true);
    const file=await fetch(base+'/upload/'+f.upload.id+'/raw',{headers});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.contents);
    assert.equal((await(await fetch(base+'/installation/status')).json()).data.required,false);
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}
});

test('维护 CLI 只接受文件路径、不提供明文密码参数，输出不含配置或渠道凭据',async()=>{
  const f=await fixture(),cli=join(apiRoot,'scripts/operations/cli.mjs');
  const output=execFileSync(process.execPath,[cli,'backup',...Object.entries(f.options).flatMap(([key,value])=>['--'+key.replace(/[A-Z]/g,char=>'-'+char.toLowerCase()),value])],{encoding:'utf8'});
  assert.ok(JSON.parse(output).id);assert.doesNotMatch(output,/synthetic-channel-secret|JWT_SECRET|owner@/);
  assert.throws(()=>execFileSync(process.execPath,[cli,'recover-admin','--password','not-accepted'],{stdio:'pipe'}));
});
