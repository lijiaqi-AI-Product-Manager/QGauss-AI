import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,copyFileSync,rmSync,readdirSync,mkdirSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {JwtService} from '@nestjs/jwt';
import {NestFactory,Reflector} from '@nestjs/core';
import {Module,ValidationPipe} from '@nestjs/common';
import {JwtAuthGuard} from '../dist/common/guards/jwt-auth.guard.js';
import {RolesGuard} from '../dist/common/guards/roles.guard.js';
import {AllExceptionsFilter} from '../dist/common/filters/all-exceptions.filter.js';
import {TransformInterceptor} from '../dist/common/interceptors/transform.interceptor.js';
import {PhoneAuthController,PhoneIdentityController} from '../dist/modules/auth/phone.controller.js';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
import {SecretBox} from '../dist/common/crypto/secret-box.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
import {CONFIG_MAP} from '../dist/common/config/config.registry.js';
import {withAuthSession} from '../dist/common/decorators/current-user.decorator.js';
import {AuthService} from '../dist/modules/auth/auth.service.js';
import {JwtStrategy} from '../dist/modules/auth/jwt.strategy.js';
import {CaptchaService} from '../dist/modules/auth/captcha.service.js';
import {PhoneDeliveryService} from '../dist/modules/auth/phone-delivery.service.js';
import {PhoneAccountService} from '../dist/modules/auth/phone-account.service.js';
import {phoneSenderConfiguration,signPhoneRequest,PhoneSender} from '../dist/modules/auth/phone-sender.js';
import {normalizedPhone,phoneActionInput,phoneLoginInput} from '../dist/modules/auth/phone-input.js';
import {historicalDatabase} from './historical-database.mjs';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-phone-')),base=join(folder,'base.db'),hash=value=>createHash('sha256').update(value).digest('hex');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe',windowsHide:true});
const isStatus=status=>error=>error.getStatus?.()===status;
const phone='+8613800000001',nextPhone='+8613900000002',password='a familiar secure 51',replacement='a new familiar key 62';
const syntheticEnv={SMS_ENABLED:'true',SMS_ACCESS_KEY_ID:'syntheticAccessKeyId',SMS_ACCESS_KEY_SECRET:'syntheticAccessKeySecret',SMS_SIGN_NAME:'QGauss AI',SMS_TEMPLATE_CODE:'SMS_123456'};
async function fixture(t,{ready=true}={}){
  const path=join(folder,randomUUID()+'.db');copyFileSync(base,path);const db=new SqliteClient({datasourceUrl:'file:'+path.replaceAll('\\','/')}),secret=randomBytes(48).toString('hex'),config={get:key=>key==='JWT_SECRET'?secret:undefined,getOrThrow:key=>key==='JWT_SECRET'?secret:undefined},values=new Map([['security.registerEnabled',true]]),settings={get:async key=>values.has(key)?values.get(key):CONFIG_MAP.get(key)?.default},rate=new RateLimitService(),captcha=new CaptchaService(),box=new SecretBox(randomBytes(32).toString('base64')),delivery=new PhoneDeliveryService(db,config,settings,captcha,rate,box),calls=[];
  delivery.sender={summary:()=>({ready,enabled:ready,provider:'aliyun',issues:[]}),send:async(number,code,key)=>{calls.push({number,code,key});return{status:'SUBMITTED',messageId:'synthetic-message'};}};
  const accounts=new PhoneAccountService(db,delivery,settings,rate),auth=new AuthService(db,new JwtService(),config,captcha,settings,{send:async()=>{},configurationSummary:()=>({ready:false})},rate),strategy=new JwtStrategy(config,db);
  t.after(async()=>{await delivery.onModuleDestroy();await db.$disconnect();});
  async function send(purpose='register',number=phone,actor,key=randomUUID()){
    const captchaId=randomUUID();captcha.save(captchaId,'aB3d');const receipt=await delivery.request(key,{phone:number,purpose,expectedVersion:0,captchaId,captchaCode:'Ab3D'},{ip:randomUUID()},actor);await delivery.draining;return{receipt:await delivery.read(key,actor),key,code:calls.find(row=>row.key===key)?.code};
  }
  async function register(number=phone,name='person_'+randomUUID().slice(0,8)){
    const proof=await send('register',number),key=randomUUID(),body={purpose:'register',phone:number,code:proof.code,password,confirmation:password,username:name,expectedVersion:0};const receipt=await accounts.apply(key,body,{ip:randomUUID()});const user=await db.user.findUniqueOrThrow({where:{username:name}});return{proof,key,body,receipt,user};
  }
  async function actor(user,secretPassword=password){const session=await auth.login({account:user.username,password:secretPassword},{ip:randomUUID()}),payload=new JwtService().decode(session.accessToken),actor=await strategy.validate(payload);return{session,actor,payload};}
  return{db,path,config,values,settings,rate,captcha,box,delivery,calls,accounts,auth,strategy,send,register,actor};
}
after(()=>{const checked=resolve(folder),parent=resolve(tmpdir());assert.ok(checked.startsWith(parent+sep)&&checked.slice(parent.length+1).startsWith('qgauss-phone-'));rmSync(checked,{recursive:true,force:true});});

test('phone input is strict and service policy remains honest without sender credentials',async t=>{
  assert.equal(normalizedPhone('0086 (138) 0000-0001'),phone);
  for(const value of [null,[],13800000001,'+1 13800000001','12800000001'])assert.throws(()=>normalizedPhone(value),isStatus(400));
  assert.throws(()=>phoneLoginInput({phone,password,code:'123456'}),isStatus(400));
  assert.throws(()=>phoneActionInput({purpose:'register',phone,code:123456,password,confirmation:password,username:'abc',expectedVersion:0}),isStatus(400));
  const f=await fixture(t,{ready:false}),key=randomUUID();assert.equal((await f.delivery.policy()).deliveryReady,false);assert.equal((await f.delivery.policy()).passwordEnabled,true);
  await assert.rejects(f.delivery.request(key,{phone,purpose:'register',expectedVersion:0,captchaId:'none',captchaCode:'none'},{ip:'synthetic'}),isStatus(503));assert.equal(await f.db.phoneVerificationRequest.count(),0);
  assert.equal(phoneSenderConfiguration({}).ready,false);assert.equal(phoneSenderConfiguration({...syntheticEnv,SMS_ACCESS_KEY_SECRET:'bad\r\nsecret'}).ready,false);
});
test('ACS3 signature matches the published independent vector and signs session credentials',()=>{
  const result=signPhoneRequest({host:'ecs.cn-shanghai.aliyuncs.com',action:'RunInstances',version:'2014-05-26',query:{ImageId:'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd',RegionId:'cn-shanghai'},accessKeyId:'YourAccessKeyId',accessKeySecret:'YourAccessKeySecret',now:new Date('2023-10-26T10:22:32Z'),nonce:'3156853299f313e23d1673dc12e1703d'});
  assert.match(result.headers.authorization,/Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0$/);
  const session=signPhoneRequest({host:'dysmsapi.aliyuncs.com',action:'SendSms',version:'2017-05-25',query:{SignName:'QGauss AI *'},accessKeyId:'synthetic',accessKeySecret:'synthetic',securityToken:'synthetic-token'});assert.match(session.headers.authorization,/x-acs-security-token/);assert.match(session.url,/QGauss%20AI%20%2A/);
});
test('sender distinguishes accepted, rejected and uncertain responses without retrying or returning provider data',async()=>{
  for(const [response,expected] of [[new Response(JSON.stringify({Code:'OK',BizId:'one'})), 'SUBMITTED'],[new Response(JSON.stringify({Code:'isv.SMS_TEMPLATE_ILLEGAL',Message:'private-provider-detail'})),'FAILED'],[new Response(JSON.stringify({Code:'InternalError'}),{status:503}),'UNKNOWN'],[new Response('not json'),'UNKNOWN'],[new Response('x'.repeat(70_000)),'UNKNOWN']]){
    let calls=0;const sender=new PhoneSender(syntheticEnv,async(url,options)=>{calls++;assert.match(url,/^https:\/\/dysmsapi\.aliyuncs\.com\//);assert.equal(options.redirect,'error');assert.equal(new URL(url).searchParams.get('PhoneNumbers'),phone.slice(3));assert.equal(options.method,'POST');return response;});const row=await sender.send(phone,'123456',randomUUID());assert.equal(row.status,expected);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(row),/private-provider-detail|123456|AccessKeySecret/);
  }
  let calls=0;const sender=new PhoneSender(syntheticEnv,async()=>{calls++;throw Error('synthetic lost acknowledgement');});assert.equal((await sender.send(phone,'123456',randomUUID())).status,'UNKNOWN');assert.equal(calls,1);
});
test('phone registration has a real nullable contact and both password sign-in paths work',async t=>{
  const f=await fixture(t),registered=await f.register(),user=registered.user;
  assert.equal(user.email,null);assert.equal(user.emailVerifiedAt,null);assert.equal(await f.db.userPhoneIdentity.count({where:{userId:user.id,phone}}),1);assert.equal(registered.receipt.status,'applied');
  const session=await f.auth.loginByPhone(phone,password,{ip:randomUUID()});assert.equal(session.user.id,user.id);assert.equal(session.user.email,null);assert.ok(session.accessToken&&session.refreshToken);assert.ok(!Object.hasOwn(session,'passwordHash'));
  assert.equal((await f.auth.login({account:user.username,password},{ip:randomUUID()})).user.id,user.id);
  assert.equal((await f.auth.refresh(session.refreshToken)).user.email,null);
  await assert.rejects(f.auth.loginByPhone(phone,'wrong',{ip:randomUUID()}),isStatus(401));await assert.rejects(f.auth.loginByPhone(nextPhone,password,{ip:randomUUID()}),isStatus(401));
  const me=await f.auth.me(user.id);for(const key of ['passwordHash','tokenVersion','adminNote'])assert.ok(!Object.hasOwn(me,key));
  assert.equal((await f.db.phoneVerificationRequest.findUniqueOrThrow({where:{id:registered.proof.key}})).codeEnc,null);
});
test('registration is atomic, consumes its code once and keeps historical receipts free of credentials',async t=>{
  const f=await fixture(t),one=await f.register();
  const historical=await f.accounts.apply(one.key,one.body);assert.equal(historical.status,'applied');assert.equal(historical.appliedAt,one.receipt.appliedAt);assert.equal(await f.db.user.count(),1);
  for(const key of ['accessToken','refreshToken','code','phone','password','subjectId'])assert.ok(!Object.hasOwn(historical,key));
  await assert.rejects(f.accounts.apply(one.key,{...one.body,password:replacement,confirmation:replacement}),isStatus(409));
  await assert.rejects(f.accounts.apply(randomUUID(),{...one.body,username:'another_user'}),isStatus(400));
  assert.equal((await f.accounts.close(one.key,{purpose:'register',expectedVersion:1})).status,'applied');assert.equal(await f.db.user.count(),1);
  assert.equal((await f.accounts.read(one.key)).status,'applied');assert.equal(f.calls.length,1);
});
test('failed code guesses survive errors and a fresh service cannot bypass the target cooldown',async t=>{
  const f=await fixture(t),proof=await f.send(),body={purpose:'register',phone,code:proof.code==='999999'?'999998':'999999',password,confirmation:password,username:'guess_budget',expectedVersion:0};
  for(let i=1;i<=5;i++){await assert.rejects(f.accounts.apply(randomUUID(),body,{ip:randomUUID()}),isStatus(400));assert.equal((await f.db.phoneVerificationRequest.findUniqueOrThrow({where:{id:proof.key}})).attempts,i);}
  await assert.rejects(f.accounts.apply(randomUUID(),{...body,code:proof.code},{ip:randomUUID()}),isStatus(400));assert.equal(await f.db.user.count(),0);
  f.delivery.rateLimit=new RateLimitService();const captchaId=randomUUID();f.captcha.save(captchaId,'ABCD');await assert.rejects(f.delivery.request(randomUUID(),{phone,purpose:'register',expectedVersion:0,captchaId,captchaCode:'ABCD'},{ip:randomUUID()}),isStatus(429));assert.equal(f.calls.length,1);
});
test('an uncertain send can be verified but is never automatically sent twice',async t=>{
  const f=await fixture(t);f.delivery.sender.send=async(number,code,key)=>{f.calls.push({number,code,key});return{status:'UNKNOWN'};};
  const proof=await f.send();assert.equal(proof.receipt.status,'unknown');
  assert.equal((await f.delivery.request(proof.key,{phone,purpose:'register',expectedVersion:0})).status,'unknown');
  for(let i=0;i<3;i++)await f.delivery.read(proof.key);f.delivery.kick();await f.delivery.draining;assert.equal(f.calls.length,1);
  const row=await f.db.phoneVerificationRequest.findUniqueOrThrow({where:{id:proof.key}});assert.equal(row.codeEnc,null);assert.ok(row.codeHash&&!row.codeHash.includes(proof.code));
  const receipt=await f.accounts.apply(randomUUID(),{purpose:'register',phone,code:proof.code,password,confirmation:password,username:'acknowledgement',expectedVersion:0});assert.equal(receipt.status,'applied');
});
test('closing a missing request fences delayed originals without sending or creating an account',async t=>{
  const f=await fixture(t),key=randomUUID(),actionKey=randomUUID();assert.equal((await f.delivery.close(key,{purpose:'register',expectedVersion:0})).status,'closed');assert.equal((await f.delivery.request(key,{phone,purpose:'register',expectedVersion:0})).status,'closed');
  assert.equal((await f.accounts.close(actionKey,{purpose:'register',expectedVersion:0})).status,'closed');assert.equal((await f.accounts.apply(actionKey,{purpose:'register',phone,code:'123456',password,confirmation:password,username:'late_request',expectedVersion:0})).status,'closed');assert.equal(f.calls.length,0);assert.equal(await f.db.user.count(),0);
  await assert.rejects(f.delivery.close(key,{purpose:'recover',expectedVersion:1}),isStatus(409));await assert.rejects(f.accounts.read(actionKey,{id:'another-owner'}),isStatus(404));
});
test('password recovery revokes only the target account and retains its creations and contact',async t=>{
  const f=await fixture(t),one=await f.register(),owner=await f.actor(one.user),other=await f.db.user.create({data:{email:'other@qgauss.test',username:'unrelated',passwordHash:await bcrypt.hash(password,10)}}),unrelated=await f.actor(other);
  await f.db.phoneVerificationRequest.update({where:{id:one.proof.key},data:{cooldownUntil:new Date(0)}});
  const conversation=await f.db.conversation.create({data:{userId:one.user.id,title:'A saved idea'}}),reset=await f.db.passwordReset.create({data:{userId:one.user.id,tokenHash:hash('synthetic-reset'),expiresAt:new Date(Date.now()+60_000)}}),proof=await f.send('recover'),key=randomUUID(),body={purpose:'recover',phone,code:proof.code,password:replacement,confirmation:replacement,expectedVersion:0};
  assert.equal((await f.accounts.apply(key,body,{ip:randomUUID()})).status,'applied');
  const changed=await f.db.user.findUniqueOrThrow({where:{id:one.user.id}});assert.equal(changed.tokenVersion,one.user.tokenVersion+1);assert.equal(changed.email,null);assert.ok(await bcrypt.compare(replacement,changed.passwordHash));assert.ok((await f.db.passwordReset.findUniqueOrThrow({where:{id:reset.id}})).usedAt);assert.ok(await f.db.conversation.findUnique({where:{id:conversation.id}}));
  await assert.rejects(f.strategy.validate(owner.payload),isStatus(401));await assert.rejects(f.auth.refresh(owner.session.refreshToken),isStatus(401));assert.equal((await f.strategy.validate(unrelated.payload)).id,other.id);
  assert.equal((await f.auth.loginByPhone(phone,replacement,{ip:randomUUID()})).user.id,one.user.id);assert.equal((await f.accounts.read(key)).status,'applied');assert.equal((await f.accounts.close(key,{purpose:'recover',expectedVersion:1})).status,'applied');
});
test('binding preserves the account and password, checks its version and rejects a different owner',async t=>{
  const f=await fixture(t),one=await f.register(),logged=await f.actor(one.user),before=await f.db.user.findUniqueOrThrow({where:{id:one.user.id}});await f.db.balance.create({data:{userId:one.user.id,balanceCents:123456}});
  const proof=await f.send('bind',nextPhone,logged.actor),key=randomUUID(),body={purpose:'bind',phone:nextPhone,code:proof.code,password,expectedUpdatedAt:before.updatedAt.toISOString(),expectedVersion:0};
  await assert.rejects(f.accounts.apply(randomUUID(),{...body,password:'wrong'},{ip:randomUUID()},logged.actor),isStatus(401));
  await assert.rejects(f.accounts.apply(randomUUID(),{...body,expectedUpdatedAt:new Date(0).toISOString()},{ip:randomUUID()},logged.actor),isStatus(409));
  assert.equal((await f.accounts.apply(key,body,{ip:randomUUID()},logged.actor)).status,'applied');const after=await f.db.user.findUniqueOrThrow({where:{id:before.id}});for(const field of ['username','email','passwordHash','role','tokenVersion','signature','adminNote'])assert.equal(after[field],before[field],field);assert.equal((await f.db.balance.findUniqueOrThrow({where:{userId:before.id}})).balanceCents,123456);
  assert.equal((await f.db.userPhoneIdentity.findUniqueOrThrow({where:{userId:before.id}})).phone,nextPhone);assert.equal((await f.strategy.validate(logged.payload)).id,before.id);assert.ok(after.updatedAt>before.updatedAt);
  assert.equal((await f.accounts.identity(logged.actor)).phoneMasked,'+86139****0002');await assert.rejects(f.accounts.read(key,{...logged.actor,id:'another-owner'}),isStatus(404));await assert.rejects(f.auth.loginByPhone(phone,password,{ip:randomUUID()}),isStatus(401));assert.equal((await f.auth.loginByPhone(nextPhone,password,{ip:randomUUID()})).user.id,before.id);
});
test('migration preserves all earlier business rows, nullable contacts and foreign-key behavior',async t=>{
  const old=join(folder,randomUUID()+'.db');historicalDatabase(old,46);const db=new SqliteClient({datasourceUrl:'file:'+old.replaceAll('\\','/')});t.after(()=>db.$disconnect());const user=await db.user.create({data:{email:'preserved@qgauss.test',username:'preserved',passwordHash:await bcrypt.hash(password,10),signature:'A line that stays',adminNote:'private note',inviteCode:'KEEPTHIS'}});
  await db.conversation.create({data:{userId:user.id,title:'Preserved creation'}});await db.refreshToken.create({data:{userId:user.id,familyId:randomUUID(),tokenHash:hash('preserved-token'),expiresAt:new Date(Date.now()+86400_000)}});await db.balance.create({data:{userId:user.id,balanceCents:321987}});await db.globalConfig.create({data:{key:'site.name',value:JSON.stringify('QGauss AI')}});await db.$disconnect();
  const snapshot=database=>{const raw=new DatabaseSync(database,{readOnly:true});try{return raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_migrations' ORDER BY name").all().map(({name})=>({name,rows:raw.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()}));}finally{raw.close();}};
  const before=snapshot(old);assert.equal(before.length,68);execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:old},stdio:'pipe',windowsHide:true});const after=snapshot(old);assert.equal(after.length,71);for(const table of before)assert.deepEqual(after.find(row=>row.name===table.name).rows,table.rows,table.name);
  const raw=new DatabaseSync(old);try{assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(raw.prepare('SELECT count(*) n FROM _migrations').get().n,readdirSync(join(here,'../prisma/migrations')).filter(file=>file.endsWith('.sql')).length);raw.exec('PRAGMA foreign_keys=ON');raw.prepare('DELETE FROM users WHERE id=?').run(user.id);assert.equal(raw.prepare('SELECT count(*) n FROM conversations').get().n,0);}finally{raw.close();}
});

test('closing a send in flight keeps a delayed provider acknowledgement from reactivating its code',async t=>{
  const f=await fixture(t),key=randomUUID(),captchaId=randomUUID();let release,started;
  const began=new Promise(resolve=>{started=resolve;});f.delivery.sender.send=async(number,code)=>{f.calls.push({number,code,key});started();return new Promise(resolve=>{release=resolve;});};f.captcha.save(captchaId,'abcd');
  await f.delivery.request(key,{phone,purpose:'register',expectedVersion:0,captchaId,captchaCode:'abcd'},{ip:randomUUID()});await began;
  const pending=await f.delivery.read(key);assert.equal(pending.status,'preparing');assert.equal((await f.delivery.close(key,{purpose:'register',expectedVersion:pending.version})).status,'closed');release({status:'SUBMITTED'});await f.delivery.draining;
  assert.equal((await f.delivery.read(key)).status,'closed');assert.equal((await f.db.phoneVerificationRequest.findUniqueOrThrow({where:{id:key}})).codeHash,null);
  await assert.rejects(f.accounts.apply(randomUUID(),{purpose:'register',phone,code:f.calls[0].code,password,confirmation:password,username:'closed_code',expectedVersion:0}),isStatus(400));assert.equal(await f.db.user.count(),0);
});
test('unknown destinations share a public acknowledgement without creating texts or account proofs',async t=>{
  const f=await fixture(t),proof=await f.send('recover');assert.equal(proof.receipt.status,'submitted');assert.equal(f.calls.length,0);assert.equal(proof.code,undefined);
  await assert.rejects(f.accounts.apply(randomUUID(),{purpose:'recover',phone,code:'123456',password:replacement,confirmation:replacement,expectedVersion:0}),isStatus(400));assert.equal(await f.db.phoneAccountAction.count(),0);
});
test('a failed account receipt write rolls back the user, phone and verification consumption together',async t=>{
  const f=await fixture(t),proof=await f.send(),real=f.db;
  f.accounts.prisma=new Proxy(real,{get(target,key){if(key==='$transaction')return callback=>target.$transaction(tx=>callback(new Proxy(tx,{get(client,property){if(property==='phoneAccountAction')return new Proxy(client.phoneAccountAction,{get(delegate,operation){if(operation==='create')return async()=>{throw Error('Synthetic receipt storage failure');};return delegate[operation];}});return client[property];}})));const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(f.accounts.apply(randomUUID(),{purpose:'register',phone,code:proof.code,password,confirmation:password,username:'rollback_account',expectedVersion:0}),/Synthetic receipt storage failure/);
  assert.equal(await real.user.count(),0);assert.equal(await real.userPhoneIdentity.count(),0);assert.equal(await real.phoneAccountAction.count(),0);const row=await real.phoneVerificationRequest.findUniqueOrThrow({where:{id:proof.key}});assert.equal(row.state,'SUBMITTED');assert.ok(row.codeHash);
});
test('administrator recovery enforces the account policy after number verification',async t=>{
  const f=await fixture(t),one=await f.register();await f.db.user.update({where:{id:one.user.id},data:{role:'ADMIN',adminNote:'keep this private'}});await f.db.phoneVerificationRequest.update({where:{id:one.proof.key},data:{cooldownUntil:new Date(0)}});const proof=await f.send('recover'),body={purpose:'recover',phone,code:proof.code,password:'weakpass9',confirmation:'weakpass9',expectedVersion:0};
  await assert.rejects(f.accounts.apply(randomUUID(),body),isStatus(422));assert.equal((await f.db.phoneVerificationRequest.findUniqueOrThrow({where:{id:proof.key}})).state,'SUBMITTED');
  assert.equal((await f.accounts.apply(randomUUID(),{...body,password:replacement,confirmation:replacement})).status,'applied');const user=await f.db.user.findUniqueOrThrow({where:{id:one.user.id}});assert.equal(user.adminNote,'keep this private');assert.equal(user.role,'ADMIN');
});
test('durable limits remain effective after process state is reset',async t=>{
  const f=await fixture(t);for(let i=0;i<10;i++)await f.db.phoneVerificationRequest.create({data:{id:randomUUID(),owner:'guest',purpose:'register',phone,state:'CLOSED',cooldownUntil:new Date(0)}});
  f.delivery.rateLimit=new RateLimitService();const captchaId=randomUUID();f.captcha.save(captchaId,'abcd');await assert.rejects(f.delivery.request(randomUUID(),{phone,purpose:'recover',expectedVersion:0,captchaId,captchaCode:'abcd'},{ip:randomUUID()}),isStatus(429));assert.equal(f.calls.length,0);assert.equal(await f.db.phoneVerificationRequest.count(),10);
});

test('phone controller routes verify real sessions, protect receipts and complete the HTTP account flow',async t=>{
  const f=await fixture(t);class TestModule{}Module({controllers:[PhoneAuthController,PhoneIdentityController],providers:[{provide:PhoneDeliveryService,useValue:f.delivery},{provide:PhoneAccountService,useValue:f.accounts},{provide:AuthService,useValue:f.auth}]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api');const reflector=new Reflector();app.useGlobalGuards(new JwtAuthGuard(reflector),new RolesGuard(reflector));app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}));app.useGlobalFilters(new AllExceptionsFilter());app.useGlobalInterceptors(new TransformInterceptor());await app.listen(0,'127.0.0.1');t.after(()=>app.close());
  const origin=await app.getUrl();
  async function request(path,{method='GET',body,token,expected=200,lang}={}){const response=await fetch(origin+'/api'+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(lang?{'accept-language':lang}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return{data:result.data??result,response};}
  assert.equal((await request('/auth/phone/policy')).response.headers.get('cache-control'),'no-store');await request('/users/me/phone',{expected:401});
  const captchaId=randomUUID(),sendKey=randomUUID();f.captcha.save(captchaId,'ABCD');await request('/auth/phone/requests/'+sendKey,{method:'POST',body:{phone,purpose:'register',expectedVersion:0,captchaId,captchaCode:'ABCD'},expected:201});await f.delivery.draining;
  const receipt=(await request('/auth/phone/requests/'+sendKey)).data;assert.equal(receipt.status,'submitted');assert.equal(receipt.phone,undefined);
  const actionKey=randomUUID();await request('/auth/phone/actions/'+actionKey,{method:'POST',body:{purpose:'register',phone,code:f.calls[0].code,password,confirmation:password,username:'http_phone_person',expectedVersion:0},expected:201});
  const login=await request('/auth/phone/login',{method:'POST',body:{phone,password},expected:201}),session=login.data;assert.equal(session.user.email,null);assert.ok(session.accessToken);assert.equal(login.response.headers.get('cache-control'),'no-store');
  const identity=(await request('/users/me/phone',{token:session.accessToken})).data;assert.equal(identity.phoneMasked,'+86138****0001');assert.equal(identity.phone,undefined);await request('/auth/phone/configuration',{token:session.accessToken,expected:403});
  await request('/auth/phone/login',{method:'POST',body:{phone,password,code:'123456'},expected:400});await request('/auth/phone/requests/'+randomUUID(),{method:'POST',body:{phone,purpose:'bind',expectedVersion:0},expected:400});
  const key=randomUUID();assert.equal((await request('/auth/phone/actions/'+key+'/close',{method:'POST',body:{purpose:'register',expectedVersion:0},expected:201})).data.status,'closed');assert.equal((await request('/auth/phone/actions/'+key,{method:'POST',body:{purpose:'register',phone:nextPhone,code:'123456',password,confirmation:password,username:'http_delayed',expectedVersion:0},expected:201})).data.status,'closed');assert.equal(await f.db.user.count(),1);
  const invalid=await request('/auth/phone/actions/'+randomUUID(),{method:'POST',body:{purpose:'recover',phone,code:'000000',password:replacement,confirmation:replacement,expectedVersion:0},expected:400,lang:'en'});assert.equal(invalid.data.message,'The text code is incorrect, expired, or already used.');
});

test('a broken account rebuild rolls back its schema and dependent business rows',async t=>{
  const path=join(folder,randomUUID()+'.db');historicalDatabase(path,46);const client=new SqliteClient({datasourceUrl:'file:'+path.replaceAll('\\','/')});t.after(()=>client.$disconnect());const user=await client.user.create({data:{email:'rollback@qgauss.test',username:'rollback_identity',passwordHash:'synthetic'}});await client.conversation.create({data:{userId:user.id,title:'Must remain available'}});await client.$disconnect();
  const scripts=mkdtempSync(join(folder,'broken-rebuild-')),migrations=join(scripts,'migrations');mkdirSync(migrations);for(const name of ['migrate.mjs','data-lease.cjs'])copyFileSync(join(here,'../prisma',name),join(scripts,name));for(const name of readdirSync(join(here,'../prisma/migrations')).filter(name=>name.endsWith('.sql')))copyFileSync(join(here,'../prisma/migrations',name),join(migrations,name));
  appendFileSync(join(migrations,'0047_phone_identity.sql'),'\nINSERT INTO user_phone_identities(userId,phone,verifiedAt,updatedAt) VALUES (\'missing-user\',\'+8613800000001\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);\n');
  assert.throws(()=>execFileSync(process.execPath,[join(scripts,'migrate.mjs')],{env:{...process.env,DATABASE_FILE:path},stdio:'pipe',windowsHide:true}),error=>error.status===1);
  const raw=new DatabaseSync(path,{readOnly:true});try{assert.equal(raw.prepare('SELECT count(*) n FROM _migrations').get().n,46);assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='user_phone_identities'").get().n,0);assert.equal(raw.prepare('PRAGMA table_info(users)').all().find(row=>row.name==='email').notnull,1);assert.equal(raw.prepare('SELECT id FROM users').get().id,user.id);assert.equal(raw.prepare('SELECT count(*) n FROM conversations').get().n,1);assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{raw.close();}
});
