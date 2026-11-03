import{test,after}from'node:test';
import assert from'node:assert/strict';
import{JSDOM}from'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://qgauss.test/voice'});
for(const name of ['window','document','navigator','localStorage'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
const originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Language changes must not request a balance');};
const{setLang}=await import('../src/i18n/index.js'),{useBalance}=await import('../src/stores/balance.js');

test('共享额度提示随语言切换，原有次数、余额和会员期限不变且不重新读取',()=>{
 const balance=useBalance();Object.assign(balance.state,{enabled:true,counts:{model3:123,model4:7,drawMj:3,agent:4},balanceCents:12345,isMember:true,expirationTime:'2030-12-01T12:00:00Z'});const original=JSON.stringify(balance.state);
 setLang('en');assert.match(balance.tooltip.value,/Basic models 123 · Advanced models 7 · Images 3 · Agents 4/);assert.match(balance.tooltip.value,/Balance ¥123\.45/);assert.match(balance.tooltip.value,/Member until/);
 setLang('zh-TW');assert.match(balance.tooltip.value,/低價模型 123/);assert.match(balance.tooltip.value,/餘額 ¥123\.45/);assert.match(balance.tooltip.value,/會員至/);
 setLang('zh');assert.match(balance.tooltip.value,/低价模型 123/);assert.equal(JSON.stringify(balance.state),original);assert.equal(requests,0);
});

after(()=>{globalThis.fetch=originalFetch;dom.window.close();});
