/** Password lifecycle uses real migrated SQLite; barriers expose stale reads deterministically. No server, SMTP or real credentials. */
import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import {SqliteClient as PrismaClient} from '../dist/common/prisma/sqlite-client.js';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { JwtStrategy } from '../dist/modules/auth/jwt.strategy.js';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { UsersService } from '../dist/modules/users/users.service.js';
import { ChangePasswordDto, UpdateProfileDto } from '../dist/modules/users/dto/user.dto.js';
import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';

const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-account-security-'));
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:join(folder,'test.db')},stdio:'pipe'});
const prisma=new PrismaClient({datasources:{db:{url:'file:'+join(folder,'test.db').replace(/\\/g,'/')}}});
const secret=randomBytes(48).toString('base64url'),config={get:key=>key==='JWT_SECRET'?secret:undefined,getOrThrow:()=>secret};
const settings={get:async key=>key==='site.baseUrl'?'http://qgauss.test':1000},mail=[];
const mailer={send:async(type,to,context)=>{mail.push({type,to,context});return{ok:true};}};
function authWith(db=prisma){return new AuthService(db,new JwtService({secret}),config,{verify:()=>true},settings,mailer,new RateLimitService());}
const auth=authWith(),users=new UsersService(prisma,new RateLimitService()),strategy=new JwtStrategy(config,prisma);
const initialPassword='IsolatedOldPass-123';
async function userFixture(){const name='account-'+randomUUID();return prisma.user.create({data:{username:name,email:name+'@qgauss.test',passwordHash:await bcrypt.hash(initialPassword,10)}});}
const login=user=>auth.login({account:user.email,password:initialPassword},{ip:user.id,userAgent:'QGauss isolated browser'});
const hash=value=>createHash('sha256').update(value).digest('hex');
async function resetFixture(user){await auth.forgotPassword(user.email,{ip:user.id});return new URL(mail.at(-1).context.resetUrl).searchParams.get('token');}
function readBarrier(model,method,count=1){let release,arrived;const gate=new Promise(done=>release=done),reached=new Promise(done=>arrived=done);let seen=0;const delegate=new Proxy(prisma[model],{get(target,key){if(key!==method){const value=target[key];return typeof value==='function'?value.bind(target):value;}return async(...args)=>{const value=await target[method](...args);seen++;if(seen>=count)arrived();await gate;return value;};}});const db=new Proxy(prisma,{get(target,key){if(key===model)return delegate;const value=target[key];return typeof value==='function'?value.bind(target):value;}});return{db,reached,release};}
after(async()=>{await prisma.$disconnect();const target=resolve(folder);assert.ok(target.startsWith(resolve(tmpdir())+sep+'qgauss-account-security-'));rmSync(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('profile and password validation preserves JSON types, trims only names and bounds avatar metadata',async()=>{
  const pipe=new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}});
  const transform=(data,metatype)=>pipe.transform(data,{type:'body',metatype});
  assert.equal((await transform({displayName:'  灵感伙伴  '},UpdateProfileDto)).displayName,'灵感伙伴');
  for(const displayName of ['', ' '.repeat(4), null, 12345, [], {}, '字'.repeat(33)])await assert.rejects(()=>transform({displayName},UpdateProfileDto),error=>error.getStatus()===400);
  await assert.rejects(()=>transform({avatar:'x'.repeat(2049)},UpdateProfileDto),error=>error.getStatus()===400);
  for(const newPassword of [12345678,null,{},'short'])await assert.rejects(()=>transform({oldPassword:initialPassword,newPassword},ChangePasswordDto),error=>error.getStatus()===400);
});
test('successful sign-in returns profile appearance but no password hash or token version',async()=>{
  const user=await userFixture();await users.updateProfile(user.id,{displayName:'你的灵感搭档',avatar:'qgauss:coral'});
  const session=await login(user);assert.equal(session.user.displayName,'你的灵感搭档');assert.equal(session.user.avatar,'qgauss:coral');
  assert.equal(Object.hasOwn(session.user,'passwordHash'),false);assert.equal(Object.hasOwn(await auth.me(user.id),'tokenVersion'),false);
});
test('two changes based on the same original password commit exactly once',async()=>{
  const user=await userFixture(),gate=readBarrier('user','findUnique',2),service=new UsersService(gate.db,new RateLimitService());
  const pending=Promise.allSettled([service.changePassword(user.id,initialPassword,'ChangedFirst-456'),service.changePassword(user.id,initialPassword,'ChangedSecond-789')]);
  await gate.reached;gate.release();const results=await pending;assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const saved=await prisma.user.findUnique({where:{id:user.id}});assert.equal(saved.tokenVersion,1);
});
test('changing a password invalidates outstanding reset links and every prior login',async()=>{
  const user=await userFixture(),session=await login(user),token=await resetFixture(user);
  await users.changePassword(user.id,initialPassword,'ChangedSecure-456');
  await assert.rejects(()=>auth.resetPassword(token,'UnexpectedOverride-789',{ip:user.id}));
  await assert.rejects(()=>auth.refresh(session.refreshToken));await assert.rejects(()=>strategy.validate(new JwtService({secret}).verify(session.accessToken)));
  assert.equal(await bcrypt.compare('ChangedSecure-456',(await prisma.user.findUnique({where:{id:user.id}})).passwordHash),true);
});
test('one reset link can win only once when submitted concurrently',async()=>{
  const user=await userFixture(),token=await resetFixture(user),gate=readBarrier('passwordReset','findUnique',2),service=authWith(gate.db);
  const pending=Promise.allSettled([service.resetPassword(token,'ResetFirst-456',{ip:user.id}),service.resetPassword(token,'ResetSecond-789',{ip:user.id})]);
  await gate.reached;gate.release();const results=await pending;assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await prisma.user.findUnique({where:{id:user.id}})).tokenVersion,1);
});
test('a reset link expiring after its first read cannot change the password',async()=>{
  const user=await userFixture(),token=await resetFixture(user),gate=readBarrier('passwordReset','findUnique'),service=authWith(gate.db);
  const pending=service.resetPassword(token,'TooLateReset-456',{ip:user.id});await gate.reached;
  await prisma.passwordReset.update({where:{tokenHash:hash(token)},data:{expiresAt:new Date(Date.now()-1000)}});gate.release();
  await assert.rejects(()=>pending);assert.equal(await bcrypt.compare(initialPassword,(await prisma.user.findUnique({where:{id:user.id}})).passwordHash),true);
});
test('old login credentials read before a password change cannot mint a later session',async()=>{
  const user=await userFixture(),gate=readBarrier('user','findFirst'),service=authWith(gate.db);
  const pending=service.login({account:user.email,password:initialPassword},{ip:user.id});await gate.reached;
  await users.changePassword(user.id,initialPassword,'NewAdmission-456');gate.release();
  await assert.rejects(()=>pending);assert.equal(await prisma.refreshToken.count({where:{userId:user.id,revokedAt:null}}),0);
});
test('logout revokes its access and refresh family while a different login remains usable',async()=>{
  const user=await userFixture(),first=await login(user),second=await login(user),jwt=new JwtService({secret});
  await strategy.validate(jwt.verify(first.accessToken));await auth.logout(first.refreshToken,{ip:user.id});
  await assert.rejects(()=>strategy.validate(jwt.verify(first.accessToken)));await assert.rejects(()=>auth.refresh(first.refreshToken));
  assert.equal((await strategy.validate(jwt.verify(second.accessToken))).id,user.id);
});
test('a refresh paused before logout cannot recreate that revoked login',async()=>{
  const user=await userFixture(),session=await login(user),gate=readBarrier('refreshToken','findUnique'),service=authWith(gate.db);
  const pending=service.refresh(session.refreshToken,{ip:user.id});await gate.reached;await auth.logout(session.refreshToken,{ip:user.id});gate.release();
  await assert.rejects(()=>pending);assert.equal(await prisma.refreshToken.count({where:{userId:user.id,revokedAt:null}}),0);
});
test('refresh reuse within the grace period remains valid and replay outside it commits family revocation',async()=>{
  const user=await userFixture(),session=await login(user);const first=await auth.refresh(session.refreshToken),second=await auth.refresh(session.refreshToken);
  assert.ok(first.accessToken&&second.accessToken);await prisma.refreshToken.update({where:{tokenHash:hash(session.refreshToken)},data:{usedAt:new Date(Date.now()-20000)}});
  await assert.rejects(()=>auth.refresh(session.refreshToken));assert.equal(await prisma.refreshToken.count({where:{userId:user.id,revokedAt:null}}),0);
});
test('concurrent forgot-password requests leave only one currently usable link',async()=>{
  const user=await userFixture();await Promise.all([auth.forgotPassword(user.email,{ip:user.id}),auth.forgotPassword(user.email,{ip:user.id})]);
  assert.equal(await prisma.passwordReset.count({where:{userId:user.id,usedAt:null}}),1);
});
test('own login history is paginated, stable, private and bounded',async()=>{
  const user=await userFixture(),other=await userFixture(),at=new Date();for(const id of ['a','b','c'])await prisma.userLoginLog.create({data:{id:user.id+'-'+id,userId:user.id,account:user.email,success:true,createdAt:at,userAgent:'QGauss test browser'}});
  await prisma.userLoginLog.create({data:{userId:other.id,account:other.email,success:false}});
  const page=await users.ownLoginLogs(user.id,1,2);assert.equal(page.total,3);assert.equal(page.items.length,2);assert.ok(page.items[0].id.endsWith('-c'));
  assert.ok(page.items.every(row=>!Object.hasOwn(row,'account')&&!Object.hasOwn(row,'userId')&&!Object.hasOwn(row,'reason')));
  assert.equal((await users.ownLoginLogs(user.id,2,2)).items.length,1);
  for(const [p,s] of [[0,4],[NaN,4],[1,101],[-1,4],[1.5,4]])await assert.rejects(()=>users.ownLoginLogs(user.id,p,s),error=>error.getStatus()===400);
});
test('logout is explicitly public so the browser can revoke a refresh credential after clearing local access',()=>{
  assert.equal(Reflect.getMetadata('isPublic',AuthController.prototype.logout),true);
});
test('access-only logout revokes exactly the signed login family',async()=>{
  const user=await userFixture(),first=await login(user),second=await login(user),jwt=new JwtService({secret});
  await auth.logout(undefined,{ip:user.id},first.accessToken);await assert.rejects(()=>strategy.validate(jwt.verify(first.accessToken)));
  await assert.rejects(()=>auth.refresh(first.refreshToken));assert.equal((await strategy.validate(jwt.verify(second.accessToken))).id,user.id);
});
test('failure while invalidating reset links rolls back the new password and login revocation',async()=>{
  const user=await userFixture(),session=await login(user),token=await resetFixture(user);
  const db=new Proxy(prisma,{get(target,key){if(key==='$transaction')return action=>prisma.$transaction(tx=>action(new Proxy(tx,{get(current,field){if(field==='passwordReset')return new Proxy(current.passwordReset,{get(delegate,method){if(method==='updateMany')return async()=>{throw Error('isolated reset invalidation failure');};const value=delegate[method];return typeof value==='function'?value.bind(delegate):value;}});const value=current[field];return typeof value==='function'?value.bind(current):value;}})));const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(()=>new UsersService(db,new RateLimitService()).changePassword(user.id,initialPassword,'MustRollback-456'),/isolated reset invalidation failure/);
  const saved=await prisma.user.findUnique({where:{id:user.id}});assert.equal(saved.tokenVersion,0);assert.equal(await bcrypt.compare(initialPassword,saved.passwordHash),true);
  assert.equal((await prisma.passwordReset.findUnique({where:{tokenHash:hash(token)}})).usedAt,null);assert.equal((await prisma.refreshToken.findUnique({where:{tokenHash:hash(session.refreshToken)}})).revokedAt,null);
});
