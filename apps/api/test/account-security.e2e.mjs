/** Account and password lifecycle through actual HTTP, copied database and disabled SMTP only. */
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import {randomBytes,createHash} from 'node:crypto';
import {basename,resolve} from 'node:path';
const root=process.env.E2E_API||'http://127.0.0.1:9520/api',prisma=new PrismaClient(),tag=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
let admin='',passed=0,original={};
const initialPassword='QGaussOld-12345',changedPassword='QGaussChanged-456',resetPassword='QGaussReset-789';
function check(name,condition){assert.ok(condition,name);passed++;console.log('  ✔ '+name);}
async function api(path,method='GET',body,access=admin){const response=await fetch(root+path,{method,headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const raw=await response.json();return{status:response.status,data:raw.data,error:raw.message};}
async function settings(values){assert.equal((await api('/settings','PUT',{settings:Object.entries(values).map(([key,value])=>({key,value}))})).status,200);}
async function signIn(user,password=initialPassword){return api('/auth/login','POST',{account:user.email,password},'');}
async function userFixture(suffix){const email='qa'+tag+suffix+'@qgauss.test',username='qa'+tag+suffix;const response=await api('/auth/register','POST',{email,username,password:initialPassword},'');assert.ok(response.data?.accessToken,'isolated registration');return{...response.data,email,id:response.data.user.id};}
async function resetLink(user){assert.equal((await api('/auth/forgot-password','POST',{email:user.email},'')).status,503);const file=process.env.E2E_DATABASE_FILE;assert.ok(file&&basename(file)==='e2e.db','reset fixtures require the isolated database');assert.equal(resolve((await prisma.$queryRawUnsafe('PRAGMA database_list')).find(row=>row.name==='main').file),resolve(file));const token=randomBytes(24).toString('hex');await prisma.passwordReset.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+1800000)}});return{token};}
try{
  const login=await api('/auth/login','POST',{account:process.env.E2E_ADMIN||'admin',password:process.env.E2E_PASSWORD||'admin123456'},'');admin=login.data?.accessToken;assert.ok(admin);
  const keys=['security.registerEnabled','security.captchaEnabled','security.loginRateLimit','security.registerRateLimit'];const stored=await prisma.globalConfig.findMany({where:{key:{in:keys}}});original=Object.fromEntries(stored.map(row=>{let value;try{value=JSON.parse(row.value);}catch{value=row.value;}return[row.key,value];}));
  await settings({'security.registerEnabled':true,'security.captchaEnabled':false,'security.loginRateLimit':5000,'security.registerRateLimit':5000});
  const first=await userFixture('a'),second=await userFixture('b');
  check('匿名不能读取个人资料与登录足迹',(await api('/users/profile','GET',undefined,'')).status===401&&(await api('/users/logins','GET',undefined,'')).status===401);
  const profile=(await api('/users/profile','GET',undefined,first.accessToken)).data;
  check('个人资料属于当前登录者且不返回密码与凭证版本',profile.id===first.id&&!Object.hasOwn(profile,'passwordHash')&&!Object.hasOwn(profile,'tokenVersion'));
  const changed=(await api('/users/profile','PATCH',{displayName:'  灵感伙伴  ',avatar:'qgauss:coral'},first.accessToken)).data;
  check('昵称清理首尾空格并保存自有头像',changed.displayName==='灵感伙伴'&&changed.avatar==='qgauss:coral');
  const other=(await api('/users/profile','GET',undefined,second.accessToken)).data;check('编辑资料不影响其他账户',other.id===second.id&&other.displayName!=='灵感伙伴');
  await api('/users/profile','PATCH',{role:'ADMIN',displayName:'灵感伙伴'},first.accessToken);check('个人资料写入不能提升权限',(await api('/users/profile','GET',undefined,first.accessToken)).data.role==='USER');
  for(const value of [null,12345,'   ','字'.repeat(33)])check('拒绝非法昵称 '+String(value).slice(0,12),(await api('/users/profile','PATCH',{displayName:value},first.accessToken)).status===400);
  check('过长头像元数据被拒绝',(await api('/users/profile','PATCH',{avatar:'x'.repeat(2049)},first.accessToken)).status===400);
  const signed=(await signIn(first)).data;check('再次登录带回已保存昵称与头像',signed.user.displayName==='灵感伙伴'&&signed.user.avatar==='qgauss:coral');
  const at=new Date('2026-10-30T08:00:00Z');for(let index=0;index<6;index++)await prisma.userLoginLog.create({data:{id:'account-'+tag+'-'+index,userId:first.id,account:first.email,success:index!==2,ip:'192.0.2.'+(20+index),userAgent:'QGauss synthetic browser',createdAt:at}});
  await prisma.userLoginLog.create({data:{id:'other-account-'+tag,userId:second.id,account:second.email,success:true}});
  const history=(await api('/users/logins?page=1&pageSize=4','GET',undefined,first.accessToken)).data,history2=(await api('/users/logins?page=2&pageSize=4','GET',undefined,first.accessToken)).data;
  check('本人登录足迹支持真实分页与总数',history.items.length===4&&history2.items.length>0&&history.total===history2.total&&history.total===await prisma.userLoginLog.count({where:{userId:first.id}}));
  check('本人登录足迹不暴露内部账号或失败原因',history.items.every(row=>!Object.hasOwn(row,'account')&&!Object.hasOwn(row,'userId')&&!Object.hasOwn(row,'reason')));
  check('第二页不重复第一页的记录',!history2.items.some(row=>history.items.some(old=>old.id===row.id)));
  const attempted=(await api('/users/logins?userId='+second.id,'GET',undefined,first.accessToken)).data;check('请求其他用户标识仍只读取本人足迹',!attempted.items.some(row=>row.id==='other-account-'+tag));
  check('普通用户不能使用管理员查看他人足迹的入口',(await api('/users/'+second.id+'/logins','GET',undefined,first.accessToken)).status===403);
  for(const query of ['page=0','page=-1','page=NaN','page=1&page=2','pageSize=101'])check('登录足迹拒绝非法分页 '+query,(await api('/users/logins?'+query,'GET',undefined,first.accessToken)).status===400);
  check('错误的当前密码不能修改账户',(await api('/users/password','POST',{oldPassword:'WrongSynthetic-123',newPassword:changedPassword},first.accessToken)).status===400);
  check('新旧密码相同被拒绝',(await api('/users/password','POST',{oldPassword:initialPassword,newPassword:initialPassword},first.accessToken)).status===400);
  check('密码字段不接受隐式数字转换',(await api('/users/password','POST',{oldPassword:initialPassword,newPassword:12345678},first.accessToken)).status===400);
  const stale=await resetLink(first);check('未配置邮件时不创建不可投递的找回邮件',await prisma.mailOutbox.count({where:{to:first.email,template:'resetPassword'}})===0);
  check('本人能够明确修改密码',(await api('/users/password','POST',{oldPassword:initialPassword,newPassword:changedPassword},first.accessToken)).data?.ok===true);
  check('改密后所有旧登录立即失效',(await api('/users/profile','GET',undefined,first.accessToken)).status===401&&(await api('/users/profile','GET',undefined,signed.accessToken)).status===401);
  check('改密后旧刷新凭证不能建立新登录',(await api('/auth/refresh','POST',{refreshToken:first.refreshToken},'')).status===401);
  check('改密后旧重置链接不能覆盖新密码',(await api('/auth/reset-password','POST',{token:stale.token,newPassword:'ForbiddenOverride-123'},'')).status===400);
  check('旧密码无法再次登录',(await signIn(first)).status===401);const fresh=(await signIn(first,changedPassword)).data;check('新密码能够重新登录',!!fresh?.accessToken);
  const next=await resetLink(first);const resets=await Promise.all([api('/auth/reset-password','POST',{token:next.token,newPassword:resetPassword},''),api('/auth/reset-password','POST',{token:next.token,newPassword:'AlternativeReset-123'},'')]);
  check('同一重置链接并发提交仅成功一次',resets.filter(row=>row.data?.ok).length===1&&resets.some(row=>row.status===400));
  const current=await prisma.user.findUnique({where:{id:first.id}});check('重置只增加一次凭证版本',current.tokenVersion===2);
  check('重置完成后此前登录失效',(await api('/users/profile','GET',undefined,fresh.accessToken)).status===401);
  check('已使用的重置链接不能再使用',(await api('/auth/reset-password','POST',{token:next.token,newPassword:'RepeatedReset-123'},'')).status===400);
  const accepted=await bcrypt.compare(resetPassword,current.passwordHash)?resetPassword:'AlternativeReset-123';check('重置后可用最终密码登录',!!(await signIn(first,accepted)).data?.accessToken);
  const b1=(await signIn(second)).data,b2=(await signIn(second)).data;check('仅持有效登录凭证也可退出当前登录',(await api('/auth/logout','POST',{},b1.accessToken)).data?.ok===true);
  check('退出的登录不能再访问或刷新',(await api('/users/profile','GET',undefined,b1.accessToken)).status===401&&(await api('/auth/refresh','POST',{refreshToken:b1.refreshToken},'')).status===401);
  check('退出一次登录不会影响另一次独立登录',(await api('/users/profile','GET',undefined,b2.accessToken)).status===200);
  check('浏览器清除本地凭证后仍可用刷新凭证退出',(await api('/auth/logout','POST',{refreshToken:b2.refreshToken},'')).data?.ok===true);
  check('无登录头退出后旧访问凭证也立即失效',(await api('/users/profile','GET',undefined,b2.accessToken)).status===401);
  check('重复退出或未知凭证不暴露账户信息',(await api('/auth/logout','POST',{refreshToken:b2.refreshToken},'')).data?.ok===true&&(await api('/auth/logout','POST',{refreshToken:'qgauss-unknown-synthetic-credential'},'')).data?.ok===true);
  const disabled=await userFixture('c'),disabledLink=await resetLink(disabled);await api('/users/'+disabled.id+'/status','PATCH',{status:'DISABLED'});
  check('被停用的账户不能借重置链接修改密码',(await api('/auth/reset-password','POST',{token:disabledLink.token,newPassword:'DisabledReset-123'},'')).status===403);
  check('被停用账户密码保持原样',await bcrypt.compare(initialPassword,(await prisma.user.findUnique({where:{id:disabled.id}})).passwordHash));
  const limited=await userFixture('d');let last;for(let index=0;index<6;index++)last=await api('/users/password','POST',{oldPassword:'WrongSynthetic-123',newPassword:changedPassword},limited.accessToken);
  check('频繁尝试当前密码会暂时限制',last.status===429);
}finally{if(admin&&Object.keys(original).length)await settings(original).catch(()=>{});await prisma.$disconnect();}
console.log('\n账户与密码回归：'+passed+' 通过 / 0 失败');
