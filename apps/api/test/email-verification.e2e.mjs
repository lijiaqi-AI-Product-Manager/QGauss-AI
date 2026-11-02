/** Actual Nest HTTP + Nodemailer + loopback SMTP, isolated migrated DB. Never reads host secrets or sends externally. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {PrismaClient} from '@prisma/client';
import {NestFactory} from '@nestjs/core';
import {ValidationPipe} from '@nestjs/common';
import {smtpLoopback,deliveredCode} from './helpers/smtp-loopback.mjs';
const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-email-http-')),database=join(folder,'email.db'),smtp=await smtpLoopback();let app,db,base,checks=0;
const priorCwd=process.cwd();process.chdir(folder);
const prior={...process.env};for(const key of Object.keys(process.env))if(key.startsWith('MAIL_'))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'development',DATABASE_FILE:database,DATABASE_URL:'file:'+database.replace(/\\/g,'/'),JWT_SECRET:randomBytes(48).toString('base64url'),APP_ENCRYPTION_KEY:randomBytes(32).toString('base64'),STORAGE_DIR:join(folder,'uploads'),MAIL_SMTP_HOST:'127.0.0.1',MAIL_SMTP_PORT:String(smtp.port),MAIL_SMTP_SECURE:'false',MAIL_SMTP_REQUIRE_TLS:'false',MAIL_FROM:'QGauss AI <sender@qgauss.test>',MAIL_SMTP_USER:'',MAIL_SMTP_PASS:'',QGAUSS_SETUP_TOKEN:randomBytes(32).toString('base64url')});
const check=(name,condition)=>{assert.ok(condition,name);checks++;console.log('  ✔ '+name);};
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,ready,label){for(let i=0;i<120;i++){const value=await read();if(ready(value))return value;await pause(30);}throw Error('Timed out: '+label);}
async function api(path,method='GET',body,token){const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});const row=await response.json();return{status:response.status,data:row.data,message:row.message};}
let CaptchaService;
async function start(){const{AppModule}=await import('../dist/app.module.js'),{AllExceptionsFilter}=await import('../dist/common/filters/all-exceptions.filter.js'),{TransformInterceptor}=await import('../dist/common/interceptors/transform.interceptor.js');({CaptchaService}=await import('../dist/modules/auth/captcha.service.js'));app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api');app.set('trust proxy',false);app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}));app.useGlobalFilters(new AllExceptionsFilter());app.useGlobalInterceptors(new TransformInterceptor());await app.listen(0,'127.0.0.1');base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api';}
function captcha(){const id=randomUUID();app.get(CaptchaService).save(id,'QG26');return{captchaId:id,captchaCode:'QG26'};}
const codeFor=email=>until(async()=>smtp.messages.filter(m=>m.to.includes(email)&&deliveredCode(m)).at(-1),Boolean,'local verification delivery').then(deliveredCode);
const email=prefix=>prefix+'-'+randomUUID().slice(0,8)+'@qgauss.test';
try{
 execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
 const password='QgaussSynthetic-123',admin=await db.user.create({data:{email:email('admin'),username:'mail-admin',role:'ADMIN',passwordHash:await bcrypt.hash(password,10)}}),owner=await db.user.create({data:{email:email('owner'),username:'mail-owner',passwordHash:await bcrypt.hash(password,10)}}),other=await db.user.create({data:{email:email('other'),username:'mail-other',passwordHash:await bcrypt.hash(password,10)}});
 for(const[key,value]of Object.entries({'security.registerEnabled':true,'security.registerRateLimit':100,'security.captchaEnabled':true}))await db.globalConfig.upsert({where:{key},create:{key,value:JSON.stringify(value)},update:{value:JSON.stringify(value)}});
 await start();const login=async user=>(await api('/auth/login','POST',{account:user.email,password})).data,adminToken=(await login(admin)).accessToken,ownerToken=(await login(owner)).accessToken,otherToken=(await login(other)).accessToken;
 const policy=(await api('/auth/registration-policy')).data;check('公开策略说明是否必验和发件就绪，不返回地址或凭据',!policy.emailVerificationRequired&&policy.emailDeliveryReady&&Object.keys(policy).sort().join(',')==='emailDeliveryReady,emailVerificationRequired,expiresIn,resendAfter');
 check('普通用户不能改变注册要求',(await api('/settings','PUT',{settings:[{key:'security.emailVerificationRequired',value:true}]},ownerToken)).status===403);
 check('管理员可在发件准备后开启必验',(await api('/settings','PUT',{settings:[{key:'security.emailVerificationRequired',value:true}]},adminToken)).status===200);
 check('策略读取反映已保存的必验设置',(await api('/auth/registration-policy')).data.emailVerificationRequired===true);
 const target=email('new'),dto={username:'new-'+randomUUID().slice(0,8),email:target,password};
 check('只有图形验证码不能绕过邮箱必验',(await api('/auth/register','POST',{...dto,...captcha()})).status===400);
 check('错误图形验证码不创建邮件',(await api('/auth/registration-code','POST',{email:target,captchaId:randomUUID(),captchaCode:'bad'})).status===400&&await db.mailOutbox.count({where:{to:target}})===0);
 const first=(await api('/auth/registration-code','POST',{email:target,...captcha()})).data,firstCode=await codeFor(target);
 check('通过真实 SMTP 投递给本地收件箱并返回六位代码',/^\d{6}$/.test(firstCode)&&!!first.challengeId);
 check('回复不暴露验证码或收件地址',Object.keys(first).sort().join(',')==='challengeId,expiresAt,resendAfter');
 check('立即重新发送会明确限流',(await api('/auth/registration-code','POST',{email:target,...captcha()})).status===429);
 check('代码不能换一个地址创建账户',(await api('/auth/register','POST',{...dto,email:email('wrong'),emailChallengeId:first.challengeId,emailCode:firstCode})).status===400);
 const numeric=Number(firstCode);check('数值类型代码不会隐式通过校验',(await api('/auth/register','POST',{...dto,emailChallengeId:first.challengeId,emailCode:numeric})).status===400);
 const accepted=await api('/auth/register','POST',{...dto,emailChallengeId:first.challengeId,emailCode:firstCode});check('有效代码创建已验证的账户并正常签发登录',accepted.status===201&&!!accepted.data?.user.emailVerifiedAt&&!!accepted.data?.accessToken);
 check('验证过的地址在本人资料中保持验证时间',!!(await api('/users/profile','GET',undefined,accepted.data.accessToken)).data.emailVerifiedAt);
 check('同一代码不能再次创建账户',(await api('/auth/register','POST',{...dto,username:'again-'+randomUUID().slice(0,8),emailChallengeId:first.challengeId,emailCode:firstCode})).status===400);
 check('未登录不能寄送个人邮箱验证码',(await api('/auth/email-verification/send','POST',{})).status===401);
 const own=(await api('/auth/email-verification/send','POST',{},ownerToken)).data,ownCode=await codeFor(owner.email);
 check('个人验证码不可由另一账户使用',(await api('/auth/email-verification/confirm','POST',{challengeId:own.challengeId,code:ownCode},otherToken)).status===400);
 const confirmed=await api('/auth/email-verification/confirm','POST',{challengeId:own.challengeId,code:ownCode},ownerToken);check('本人确认更新当前邮箱',confirmed.status===201&&!!confirmed.data.emailVerifiedAt);
 check('再次确认不会重复生效',(await api('/auth/email-verification/confirm','POST',{challengeId:own.challengeId,code:ownCode},ownerToken)).status===400);
 check('已验证邮箱不再重复寄送',(await api('/auth/email-verification/send','POST',{},ownerToken)).status===400);
 const limitedEmail=email('guess'),limited=(await api('/auth/registration-code','POST',{email:limitedEmail,...captcha()})).data,limitedCode=await codeFor(limitedEmail),wrong=limitedCode==='999999'?'888888':'999999',guessDto={email:limitedEmail,username:'guess-'+randomUUID().slice(0,8),password,emailChallengeId:limited.challengeId};
 for(let i=0;i<5;i++)check('第 '+(i+1)+' 次错误代码被拒绝',(await api('/auth/register','POST',{...guessDto,emailCode:wrong})).status===400);
 check('五次错误后正确代码也已锁定',(await api('/auth/register','POST',{...guessDto,emailCode:limitedCode})).status===400&&(await db.emailVerification.findUnique({where:{id:limited.challengeId}})).attempts===5);
 const staleEmail=email('resend'),stale=(await api('/auth/registration-code','POST',{email:staleEmail,...captcha()})).data,staleCode=await codeFor(staleEmail);await db.emailVerification.update({where:{id:stale.challengeId},data:{createdAt:new Date(Date.now()-61000)}});
 const resent=(await api('/auth/registration-code','POST',{email:staleEmail,...captcha()})).data;await until(async()=>smtp.messages.filter(m=>m.to.includes(staleEmail)&&deliveredCode(m)).length,n=>n===2,'second local mail');
 check('重发创建新挑战并使旧代码失效',resent.challengeId!==stale.challengeId&&(await api('/auth/register','POST',{username:'stale-'+randomUUID().slice(0,8),email:staleEmail,password,emailChallengeId:stale.challengeId,emailCode:staleCode})).status===400);
 await until(()=>db.mailOutbox.count({where:{status:{in:['queued','sending']}}}),n=>n===0,'prior local deliveries');
 const {MailService}=await import('../dist/modules/mail/mail.service.js');
 await db.emailVerification.update({where:{id:resent.challengeId},data:{expiresAt:new Date(Date.now()-1000)}});
 for(const [id,reason]of [[own.challengeId,'已使用'],[resent.challengeId,'已过期']]){const original=await db.mailOutbox.findFirstOrThrow({where:{template:'emailVerification',payload:{contains:id}}}),before=smtp.messages.length,retry=await db.mailOutbox.create({data:{to:original.to,template:original.template,subject:original.subject,body:original.body,payload:original.payload,requestedById:original.requestedById,status:'queued'}});app.get(MailService).kick();const finished=await until(()=>db.mailOutbox.findUnique({where:{id:retry.id}}),r=>r.status==='suppressed','inactive code suppression');check(reason+'验证码不会因后台补寄重新发送',finished.error==='EMAIL_CODE_INACTIVE'&&smtp.messages.length===before);}
 const restartEmail=email('restart'),restart=(await api('/auth/registration-code','POST',{email:restartEmail,...captcha()})).data,restartCode=await codeFor(restartEmail);await app.close();app=undefined;await start();
 const recovered=await api('/auth/register','POST',{username:'resume-'+randomUUID().slice(0,8),email:restartEmail,password,emailChallengeId:restart.challengeId,emailCode:restartCode});check('关闭并重新创建实际 HTTP 应用后验证码仍可用且只消费一次',recovered.status===201&&!!recovered.data.user.emailVerifiedAt);
 const freshAdmin=(await login(admin)).accessToken,receipts=(await api('/mail/outbox','GET',undefined,freshAdmin)).data;check('管理回执不返回邮件正文、明文代码或挑战散列',receipts.items.every(r=>!['payload','body','code','codeHash','challengeId'].some(key=>Object.hasOwn(r,key))));
 check('旧账户开启必验后仍可正常登录',!!(await login(other)).accessToken);
 const originalName=await db.globalConfig.findUnique({where:{key:'site.name'}});const rejected=await api('/settings','PUT',{settings:[{key:'site.name',value:'Uncommitted name'},{key:'unknown.qgauss-setting',value:true}]},freshAdmin);const finalName=await db.globalConfig.findUnique({where:{key:'site.name'}});check('批量设置有一项非法时整批不写入',rejected.status===400&&JSON.stringify(originalName)===JSON.stringify(finalName));
 console.log('注册与邮箱验证 HTTP：'+checks+' 通过 / 0 失败（隔离数据库与回环 SMTP）');
}finally{await app?.close();await db?.$disconnect();await smtp.close();for(const key of Object.keys(process.env))if(!Object.hasOwn(prior,key))delete process.env[key];Object.assign(process.env,prior);process.chdir(priorCwd);assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});}
