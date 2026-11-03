import 'vue';
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {INTERFACE_MESSAGES} from '../src/i18n/interface-messages.js';
const names=['document','navigator','window','localStorage'],original=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
afterEach(()=>{for(const key of names){const d=original.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}});
function environment({saved,languages,blocked=false}){
 const entries=new Map(saved?[["qg:lang",saved]]:[]);
 Object.defineProperties(globalThis,{
  document:{configurable:true,value:{documentElement:{lang:'zh-CN'}}},
  navigator:{configurable:true,value:{languages,language:languages[0]}},
  window:{configurable:true,value:new EventTarget()},
  localStorage:{configurable:true,get(){if(blocked)throw Error('Storage access denied');return{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};}},
 });
}
test('the language module imports with storage denied and sets the initial document language before mounting',async()=>{environment({languages:['en-US'],blocked:true});const locale=await import('../src/i18n/index.js?startup-denied');assert.equal(locale.currentLang.value,'en');assert.equal(document.documentElement.lang,'en');assert.equal(locale.languageMode.value,'auto');assert.equal(locale.setLang('zh-TW'),false);assert.equal(locale.currentLang.value,'zh-TW');assert.equal(document.documentElement.lang,'zh-TW');assert.equal(locale.languageSaved.value,false);assert.equal(locale.t('nav.chat'),'對話');});
test('the initial saved choice controls the document and device mode can be restored without losing translations',async()=>{environment({saved:'zh-TW',languages:['en-US']});const locale=await import('../src/i18n/index.js?startup-saved');assert.equal(locale.currentLang.value,'zh-TW');assert.equal(document.documentElement.lang,'zh-TW');assert.equal(locale.t('entry.heading.login'),'歡迎回來。');assert.equal(locale.routeTitle('/apps',{compact:true}),'應用廣場');assert.equal(locale.setLang('auto'),true);assert.equal(document.documentElement.lang,'en');assert.equal(locale.t('entry.heading.login'),'Welcome back.');assert.equal(locale.routeTitle('/apps'),'App gallery');assert.equal(locale.routeTitle('/apps',{compact:true}),'Apps');assert.equal(locale.routeTitle('/chat',{compact:true}),'Chat');assert.equal(locale.routeTitle('/personal-route'),'');});
test('shared entry, home, navigation and appearance messages cover all three supported languages',()=>{for(const key of Object.keys(INTERFACE_MESSAGES.zh))for(const language of ['zh-TW','en'])assert.equal(typeof INTERFACE_MESSAGES[language][key],'string',language+':'+key);});
test('translated messages interpolate user text literally without replacing tokens inside it',async()=>{environment({languages:['en-US']});const locale=await import('../src/i18n/index.js?message-values');assert.equal(locale.t('home.hello',{name:'$& {greeting}',greeting:'hello'}),'Hi $& {greeting}. hello');assert.equal(locale.t('home.modelsReady',{count:2}),'2 models ready · Find your creative partner');});
