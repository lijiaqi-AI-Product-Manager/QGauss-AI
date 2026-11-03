import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID, createHash, createDecipheriv } from 'node:crypto';
import { lstat, realpath, mkdir, mkdtemp, rm, copyFile, readFile, readdir, writeFile, rename, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import bcrypt from 'bcryptjs';
import leases from '../../prisma/data-lease.cjs';
import policies from '../../dist/common/security/password-policy.js';
import environment from '../../dist/common/config/env.check.js';
import mailReceipts from '../../dist/modules/mail/mail-receipt.js';
import { backupKey, fileDigest, portablePath, encryptBundle, decryptBundle } from './archive.mjs';

const apiRoot = fileURLToPath(new URL('../../',import.meta.url));
const inside = (parent,child) => { const value=relative(parent,child);return value==='' || value!== '..' && !value.startsWith('..'+sep) && !/^[A-Za-z]:|^[/\\]/.test(value); };
async function regular(file) {
  const value=await lstat(file);
  if(!value.isFile() || value.isSymbolicLink() || value.nlink!==1)throw Error('维护输入必须是独立的普通文件，不能使用符号链接或硬链接');
  return value;
}
async function absent(file) { try {await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('目标已经存在，未覆盖任何文件'); }
async function canonical(file) { const parent=await realpath(dirname(resolve(file)));return join(parent,relative(dirname(resolve(file)),resolve(file))); }
async function privateStage(parent,run) {
  const root=await realpath(parent),folder=await mkdtemp(join(root,'.qgauss-ops-'));await chmod(folder,0o700);
  try{return await run(folder);}finally{if(dirname(resolve(folder))!==root || !folder.startsWith(join(root,'.qgauss-ops-')))throw Error('维护临时目录越界');await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
async function copyStable(from,to) {
  const before=await regular(from);await mkdir(dirname(to),{recursive:true,mode:0o700});await copyFile(from,to,constants.COPYFILE_EXCL);await chmod(to,0o600);
  const after=await regular(from);
  if(before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs)throw Error('备份期间文件发生变化，请停止所有写入后重试');
}
async function collectStorage(root) {
  try{await lstat(root);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const files=[];const seen=new Set();let total=0;
  async function visit(folder,prefix='') {
    for(const item of await readdir(folder,{withFileTypes:true})) {
      const from=join(folder,item.name),path=prefix?prefix+'/'+item.name:item.name,info=await lstat(from);
      if(info.isSymbolicLink())throw Error('本地存储含链接，未继续备份');
      if(info.isDirectory())await visit(from,path);
      else if(info.isFile() && info.nlink===1) {
        const archived='storage/'+path;
        if(!portablePath(archived) || seen.has(archived.toLowerCase()))throw Error('存储文件名不能跨平台安全恢复');
        seen.add(archived.toLowerCase());files.push({path:archived,source:from});total+=info.size;
        if(files.length>9998 || total>10*1024**3)throw Error('当前备份最多支持一万个文件、10 GiB 内容');
      } else throw Error('本地存储含不支持的文件类型');
    }
  }
  await visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}

function checkDatabase(database,env) {
  const db=new DatabaseSync(database,{readOnly:true});
  try {
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length)throw Error('数据库完整性或关联校验未通过');
    const has=name=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if(!has('_migrations') || !has('users'))throw Error('没有找到 QGauss 数据库结构');
    const migrations=db.prepare('SELECT name FROM _migrations ORDER BY name').all().map(row=>row.name);
    const known=environmentNames;
    if(!migrations.length || migrations.some((name,index)=>name!==known[index]))throw Error('备份的迁移历史不受当前版本支持');
    let key;
    if(env.APP_ENCRYPTION_KEY)key=environment.decodeEncryptionKey(env.APP_ENCRYPTION_KEY);
    else if(env.NODE_ENV==='production')throw Error('运行配置缺少独立的应用加密密钥');
    else key=createHash('sha256').update(env.JWT_SECRET || 'insecure-dev-seed').digest();
    const encrypted=[];
    if(has('channels'))encrypted.push(...db.prepare("SELECT apiKeyEnc value FROM channels WHERE apiKeyEnc<>''").all());
    if(has('channel_keys'))encrypted.push(...db.prepare("SELECT keyEnc value FROM channel_keys WHERE keyEnc<>''").all());
    if(has('agent_connections'))encrypted.push(...db.prepare("SELECT secretEnc value FROM agent_connections WHERE secretEnc<>''").all());
    for(const row of encrypted) {
      try { const [version,payload]=row.value.split(':');if(version!=='v1'||!payload)throw Error();const raw=Buffer.from(payload,'base64'),decipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));decipher.update(raw.subarray(28));decipher.final(); }
      catch{throw Error('数据库中的服务凭据与所提供运行配置不匹配');}
    }
    const uploads=has('upload_files')?db.prepare('SELECT storedKey,size,sha256,backend FROM upload_files WHERE deletedAt IS NULL').all():[];
    if(uploads.some(row=>row.backend!=='local'))throw Error('数据库含远程存储文件，本地备份工具不能证明这些文件已备份');
    const count=(table,where='1')=>has(table)?db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get().n:0;
    return {migrations,uploads,summary:{users:count('users'),conversations:count('conversations'),messages:count('messages'),uploads:uploads.length,channelKeysChecked:encrypted.length,pending:{messages:count('messages',"status IN ('PENDING','STREAMING','SETTLING')"),images:count('image_tasks',"status IN ('QUEUED','RUNNING','SETTLING')"),mail:count('mail_outbox',"status IN ('queued','sending','failed')"),voice:count('voice_tasks',"status IN ('QUEUED','RUNNING','SETTLING')"),video:count('video_tasks',"status IN ('QUEUED','SUBMITTING','POLLING','SAVING','SETTLING')"),midjourney:count('mj_tasks',"status IN ('QUEUED','SUBMITTING','MODAL_QUEUED','MODAL_SUBMITTING','WAITING_INPUT','POLLING','SAVING','SETTLING')"),mindmap:count('mindmap_generations',"status IN ('QUEUED','RUNNING','SETTLING')")}}};
  }finally{db.close();}
}
const environmentNames=(await readdir(join(apiRoot,'prisma/migrations'))).filter(name=>name.endsWith('.sql')).sort();

async function checkFiles(root,checked,files) {
  const lookup=new Map(files.map(file=>[file.path,file]));
  for(const row of checked.uploads) {
    const path='storage/'+row.storedKey;
    if(!portablePath(path))throw Error('数据库文件引用包含非法路径');
    const file=lookup.get(path);
    if(!file || file.bytes!==row.size || file.sha256!==row.sha256)throw Error('存在缺失或不匹配的上传文件，备份未通过完整校验');
  }
  return {id:checked.id,files:files.length,...checked.summary};
}

async function backupInputs(options) {
  for(const field of ['database','storage','envFile','keyFile','output'])if(typeof options[field]!=='string'||!options[field])throw Error('请明确提供 database、storage、env-file、key-file 和 output 路径');
  await regular(options.envFile);await regular(options.keyFile);
  const database=await canonical(options.database),envFile=await realpath(options.envFile),keyFile=await realpath(options.keyFile),output=await canonical(options.output);
  let storage=resolve(options.storage);
  try{const info=await lstat(storage);if(!info.isDirectory()||info.isSymbolicLink())throw Error('本地存储必须是目录，不能使用链接');storage=await realpath(storage);}catch(error){if(error.code!=='ENOENT')throw error;}
  await regular(database);await regular(envFile);await regular(keyFile);await absent(output);
  if((await regular(envFile)).size>1024**2)throw Error('运行配置文件过大');
  if([database,envFile,keyFile].some(file=>inside(storage,file)) || inside(storage,output) || [database,envFile,keyFile].includes(output) || keyFile===envFile)throw Error('备份、密钥、数据库和运行配置必须与存储源分开');
  const env=parseEnv(await readFile(envFile,'utf8'));
  for(const publicRoot of [join(apiRoot,'../web/public'),join(apiRoot,'../web/dist'),...(env.WEB_DIST?[resolve(apiRoot,env.WEB_DIST)]:[])])if(inside(resolve(publicRoot),output)||inside(resolve(publicRoot),keyFile))throw Error('备份或密钥不能保存在网页公共目录');
  if((env.STORAGE_DRIVER || 'local').toLowerCase()!=='local')throw Error('当前工具只备份本地存储，不能替代对象存储备份');
  const key=await backupKey(keyFile);return {database,storage,envFile,keyFile,output,env,key};
}

async function writeBackup(input) {
  return privateStage(dirname(input.output),async stage=>{
    const root=join(stage,'bundle');await mkdir(join(root,'database'),{recursive:true,mode:0o700});
    const source=new DatabaseSync(input.database,{readOnly:true});
    try{await backup(source,join(root,'database/qgauss.db'));}finally{source.close();}
    await chmod(join(root,'database/qgauss.db'),0o600);
    const sources=[{path:'environment/original.env',source:input.envFile},...await collectStorage(input.storage)];
    for(const file of sources)await copyStable(file.source,join(root,file.path));
    const paths=['database/qgauss.db',...sources.map(file=>file.path)],files=[];
    for(const path of paths)files.push({path,...await fileDigest(join(root,path))});
    const storedEnv=parseEnv(await readFile(join(root,'environment/original.env'),'utf8'));
    if((storedEnv.STORAGE_DRIVER||'local').toLowerCase()!=='local')throw Error('快照中的配置不是本地存储');
    const checked=checkDatabase(join(root,'database/qgauss.db'),storedEnv);await checkFiles(root,checked,files);
    const manifest={format:'QGauss AI Backup',version:1,id:randomUUID(),createdAt:new Date().toISOString(),migrations:checked.migrations,summary:checked.summary,files};
    const receipt=await encryptBundle(root,manifest,input.output,input.key);
    await validatedBundle(input.output,input.keyFile,dirname(input.output),async()=>{});
    return {...receipt,verified:true,summary:checked.summary};
  });
}

export async function createEncryptedBackup(options) {
  const input=await backupInputs(options),lease=leases.acquireDataLease(input.database);
  try{return await writeBackup(input);}finally{lease.close();}
}

export async function inspectLocalDatabase({database}) {
  if(!database)throw Error('请明确提供 database 路径');
  const file=await canonical(database);await regular(file);const lease=leases.acquireDataLease(file);let db;
  try{
    db=new DatabaseSync(file,{readOnly:true});
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('数据库完整性校验未通过');
    const administrators=db.prepare("SELECT id,email,status,deletedAt FROM users WHERE role='ADMIN' ORDER BY createdAt,id").all().map(row=>({id:row.id,mailbox:mailReceipts.maskedMailbox(row.email),status:row.deletedAt?'DELETED':row.status,recoveryAllowed:!row.deletedAt,requiresReactivate:!row.deletedAt&&row.status==='DISABLED'}));
    return {integrity:'ok',migrations:db.prepare('SELECT count(*) n FROM _migrations').get().n,administrators,environmentChecked:false};
  }finally{try{db?.close();}finally{lease.close();}}
}

async function validatedBundle(input,keyFile,parent,run) {
  await regular(input);await regular(keyFile);const key=await backupKey(keyFile);
  return privateStage(parent,async stage=>{
    const result=await decryptBundle(input,key,stage),env=parseEnv(await readFile(join(result.bundle,'environment/original.env'),'utf8'));
    const checked=checkDatabase(join(result.bundle,'database/qgauss.db'),env);
    if(JSON.stringify(checked.migrations)!==JSON.stringify(result.manifest.migrations))throw Error('迁移历史与备份清单不一致');
    await checkFiles(result.bundle,checked,result.manifest.files);
    return run({...result,summary:checked.summary});
  });
}

export async function verifyEncryptedBackup({input,keyFile,temporaryRoot}) {
  if(!input||!keyFile)throw Error('请提供 input 与 key-file 路径');
  return validatedBundle(resolve(input),resolve(keyFile),temporaryRoot?resolve(temporaryRoot):dirname(resolve(input)),async result=>({verified:true,id:result.manifest.id,files:result.manifest.files.length,summary:result.summary}));
}

export async function restoreEncryptedBackup({input,keyFile,destination}) {
  if(!input||!keyFile||!destination)throw Error('请提供 input、key-file 与全新 destination 路径');
  const target=await canonical(destination);await absent(target);
  return validatedBundle(resolve(input),resolve(keyFile),dirname(target),async result=>{
    await mkdir(target,{mode:0o700});
    // A fresh owner directory plus one bundle move publishes all validated files together.
    await rename(result.bundle,join(target,'bundle'));
    const receipt={restored:true,id:result.manifest.id,files:result.manifest.files.length,summary:result.summary,automaticStartup:false};
    await writeFile(join(target,'RESTORE-READY.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    return receipt;
  });
}

export async function recoverAdministrator(options) {
  if(!options.userId||!options.passwordFile)throw Error('请提供明确的 user-id 和 password-file');
  await regular(options.passwordFile);
  if((await lstat(options.passwordFile)).size>512)throw Error('密码文件过大');
  const password=(await readFile(options.passwordFile,'utf8')).replace(/\r?\n$/, ''),problem=policies.passwordProblem(password,true);
  if(problem||/[\r\n\0]/.test(password))throw Error(problem || '密码文件应只有一行');
  const input=await backupInputs(options),lease=leases.acquireDataLease(input.database);
  let db;
  try {
    db=new DatabaseSync(input.database);db.exec('PRAGMA foreign_keys=ON');
    const user=db.prepare('SELECT id,role,status,deletedAt,passwordHash,tokenVersion FROM users WHERE id=?').get(options.userId);
    if(!user||user.role!=='ADMIN'||user.deletedAt||user.status!=='ACTIVE'&&!(options.reactivate===true&&user.status==='DISABLED'))throw Error('只能恢复已有且未删除的管理员；普通成员不会提升，停用管理员须明确 reactivate');
    const passwordHash=await bcrypt.hash(password,10),snapshot=await writeBackup(input),id=randomUUID(),now=Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const accepted=db.prepare("UPDATE users SET passwordHash=?,tokenVersion=tokenVersion+1,status='ACTIVE',updatedAt=? WHERE id=? AND role='ADMIN' AND deletedAt IS NULL AND passwordHash=? AND tokenVersion=? AND status=?").run(passwordHash,now,user.id,user.passwordHash,user.tokenVersion,user.status);
      if(accepted.changes!==1)throw Error('账户在恢复期间发生变化，未覆盖新状态');
      const revokedSessions=db.prepare('UPDATE refresh_tokens SET revokedAt=? WHERE userId=? AND revokedAt IS NULL').run(now,user.id).changes;
      const invalidatedResetLinks=db.prepare('UPDATE password_resets SET usedAt=? WHERE userId=? AND usedAt IS NULL').run(now,user.id).changes;
      const result={recovered:true,recoveryId:id,backupId:snapshot.id,revokedSessions:Number(revokedSessions),invalidatedResetLinks:Number(invalidatedResetLinks),reactivated:user.status==='DISABLED'};
      db.prepare('INSERT INTO global_configs (key,value,updatedAt,updatedBy) VALUES (?,?,?,?)').run('operations.adminRecovery.'+id,JSON.stringify({...result,at:new Date(now).toISOString(),operator:'offline-owner'}),now,user.id);
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{try{db?.close();}finally{lease.close();}}
}
