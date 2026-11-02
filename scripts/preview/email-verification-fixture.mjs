/** Labelled local visual sample only; never imported by the product entry. */
import {accountFixtures} from './account-fixture.mjs';
export function emailVerificationFixtures(fixtures,state){
 const enabled=state?.startsWith('email-'),ready=enabled&&state!=='email-unavailable';
 const account=accountFixtures('account-profile');
 const settings=[{key:'site.name',value:'QGauss AI',defaultValue:'QGauss AI',group:'site',type:'string',description:'站点名称',public:true},{key:'security.registerEnabled',value:true,defaultValue:true,group:'security',type:'boolean',description:'开放新用户注册',public:true},{key:'security.emailVerificationRequired',value:false,defaultValue:false,group:'security',type:'boolean',description:'新用户注册时必须验证邮箱',public:true},{key:'security.captchaEnabled',value:true,defaultValue:true,group:'security',type:'boolean',description:'注册时使用图形验证码',public:true},{key:'security.registerRateLimit',value:5,defaultValue:5,group:'security',type:'number',description:'每个网络地址每分钟的注册尝试次数',public:false}];
 return{'/api/auth/registration-policy':{emailVerificationRequired:state==='email-register',emailDeliveryReady:ready,expiresIn:600,resendAfter:60},...(enabled?{...account,'/api/auth/captcha':{captchaId:'local-email-visual-sample',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="140" height="48" viewBox="0 0 140 48"><rect width="140" height="48" rx="9" fill="#eee9ff"/><text x="70" y="30" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#5842a3">QG26</text></svg>'},'/api/settings':settings,'/api/settings/public':{...fixtures['/api/settings/public'],'security.registerEnabled':true},'/api/users/profile':{...account['/api/users/profile'],...fixtures['/api/users/profile'],emailVerifiedAt:state==='email-verified'?'2026-11-02T11:00:00Z':null}}:{})};
}
export function emailVerificationAction(state,url,method,body,fixtures){
 if(!state?.startsWith('email-')||method!=='POST')return null;
 const headers={'Content-Type':'application/json','X-QGauss-Reference-Fixture':'client-preview'};
 if(['/api/auth/registration-code','/api/auth/email-verification/send'].includes(url))return new Response(JSON.stringify({code:0,data:{challengeId:'71ce2401-3443-4bf9-93ce-111111111111',expiresAt:new Date(Date.now()+600000).toISOString(),resendAfter:60}}),{status:201,headers});
 if(url==='/api/auth/email-verification/confirm'){
  if(body.code!=='246810')return new Response(JSON.stringify({code:1001,message:'本地状态样例：使用 246810 观察确认后的页面。'}),{status:400,headers});
  const emailVerifiedAt=new Date().toISOString();fixtures['/api/users/profile'].emailVerifiedAt=emailVerifiedAt;
  return new Response(JSON.stringify({code:0,data:{emailVerifiedAt}}),{status:201,headers});
 }
 return null;
}
