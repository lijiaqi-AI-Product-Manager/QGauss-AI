import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizedPhone,phonePolicy,phoneDeliveryReceipt,phoneActionReceipt,phoneSeconds,newPhoneKey,decodePhonePending} from '../src/lib/phone-identity.js';
import {readPhonePending,savePhonePending} from '../src/lib/phone-pending.js';
import {PHONE_IDENTITY_MESSAGES} from '../src/i18n/phone-messages.js';
import {accountText} from '../src/i18n/account-messages.js';

test('phone parsing retains mainland identity and rejects malformed or foreign numbers',()=>{
  for(const value of ['13800000001','+86 138-0000-0001','0086 (138) 0000 0001'])assert.equal(normalizedPhone(value),'+8613800000001');
  for(const value of [null,13800000001,[],{},'+1 13800000001','8613800000001','+86+8613800000001','12800000001','138000000010','138a0000001'])assert.equal(normalizedPhone(value),'');
});
test('receipt validation rejects secrets, substituted requests and malformed server clocks',()=>{
  const key=newPhoneKey(),now=new Date().toISOString(),base={requestKey:key,purpose:'register',status:'submitted',version:2,phoneMasked:'+86138****0001',expiresAt:now,cooldownUntil:now,serverNow:now};
  assert.ok(phoneDeliveryReceipt(base,key,'register'));
  for(const data of [{...base,code:'123456'},{...base,accessToken:'secret'},{...base,phone:'+8613800000001'},{...base,version:0},{...base,serverNow:'2026-11-11'},{...base,purpose:'recover'},{...base,requestKey:newPhoneKey()},{...base,phoneMasked:'+8613800000001'}])assert.equal(phoneDeliveryReceipt(data,key,'register'),false);
  assert.ok(phoneDeliveryReceipt({requestKey:key,purpose:'register',status:'closed',version:1,serverNow:now},key,'register'));
  assert.ok(phoneActionReceipt({requestKey:key,purpose:'recover',status:'applied',version:1,appliedAt:now,serverNow:now},key,'recover'));
  assert.equal(phoneActionReceipt({...base,status:'applied'},key,'register'),false);
  assert.equal(phoneSeconds(new Date(10_000).toISOString(),2000,3000),5);
  assert.equal(phoneSeconds('invalid'),0);
});
test('pending recovery stores only scoped request keys and respects successful storage clearing',()=>{
  const dom=new JSDOM('',{url:'https://qgauss.test'});globalThis.window=dom.window;globalThis.sessionStorage=dom.window.sessionStorage;
  const key=newPhoneKey();savePhonePending('send','owner-a','register',{key,operationVersion:0,phone:'should-not-persist',password:'should-not-persist'});
  assert.deepEqual(readPhonePending('send','owner-a','register'),{version:1,owner:'owner-a',purpose:'register',key,operationVersion:0});
  assert.equal(readPhonePending('send','owner-b','register'),null);assert.equal(readPhonePending('send','owner-a','recover'),null);
  assert.doesNotMatch(sessionStorage.getItem('qg:phone-send:owner-a:register'),/phone|password|should-not-persist/);
  const real=globalThis.sessionStorage;globalThis.sessionStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  savePhonePending('action','owner-a','bind',{key,operationVersion:1});assert.equal(readPhonePending('action','owner-a','bind').key,key);
  savePhonePending('action','owner-a','bind',null);assert.equal(readPhonePending('action','owner-a','bind'),null);
  savePhonePending('action','owner-a','bind',{key,operationVersion:2});globalThis.sessionStorage=real;assert.equal(readPhonePending('action','owner-a','bind'),null);
  globalThis.sessionStorage={getItem(){throw Error('blocked');}};assert.equal(readPhonePending('action','owner-a','bind'),null);
  assert.equal(decodePhonePending(JSON.stringify({version:1,owner:'a',purpose:'bind',key,operationVersion:0,code:'123456'}),'a','bind'),null);
  dom.window.close();delete globalThis.window;delete globalThis.sessionStorage;
});
test('phone service policy and three language catalogs are complete',()=>{
  const policy={passwordEnabled:true,registrationEnabled:false,deliveryReady:false,captchaRequired:true,country:'CN',dialCode:'+86',codeLength:6,validitySeconds:300,cooldownSeconds:60};
  assert.ok(phonePolicy(policy));assert.equal(phonePolicy({...policy,deliveryReady:'true'}),false);assert.equal(phonePolicy({...policy,validitySeconds:0}),false);
  const seen=new Set();for(const row of PHONE_IDENTITY_MESSAGES){assert.equal(row.length,3);assert.ok(row.every(value=>typeof value==='string'&&value.trim()));assert.ok(!seen.has(row[0]),row[0]);seen.add(row[0]);assert.equal(accountText('en',row[0],{phone:'masked',seconds:5}),row[2].replaceAll('{phone}','masked').replaceAll('{seconds}','5'));}
});
