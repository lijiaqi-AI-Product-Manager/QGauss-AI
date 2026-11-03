import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGE_KEY,deviceLanguage,languagePreference,createLanguagePreferences,requestLanguageHeaders} from '../src/i18n/language-preferences.js';
function fixture({saved,languages=['zh-CN'],unavailable=false,readFailure=false,writeFailure=false}={}){
 const values=new Map(saved===undefined?[]:[[LANGUAGE_KEY,saved]]),writes=[],listeners=new Map(),document={documentElement:{lang:''}},navigator={languages,language:languages[0]},changes=[];
 const storage={getItem(key){if(readFailure)throw Error('Denied');return values.get(key)??null;},setItem(key,value){if(writeFailure)throw Error('Full');values.set(key,value);writes.push([key,value]);},removeItem(key){if(writeFailure)throw Error('Denied');values.delete(key);writes.push([key,null]);}};
 const events={addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k,fn){if(listeners.get(k)===fn)listeners.delete(k);}};
 const preference=createLanguagePreferences({storage:()=>{if(unavailable)throw Error('Blocked');return storage;},navigator,document,events,onChange:s=>changes.push(s)});
 return{preference,document,navigator,storage,values,writes,listeners,changes,emit:(type,event={})=>listeners.get(type)?.(event)};
}
test('device language honors ordered supported preferences and Chinese script before region',()=>{
 for(const [list,expected]of [[['fr-FR','en-GB','zh-CN'],'en'],[['zh-Hant-HK','en'],'zh-TW'],[['zh-Hans-TW'],'zh'],[['zh-Hant-CN'],'zh-TW'],[['zh-TW'],'zh-TW'],[['zh-HK'],'zh-TW'],[['zh-MO'],'zh-TW'],[['zh-SG'],'zh'],[['zh'],'zh'],[['en-US-u-hc-h12'],'en'],[['invalid!','zh-TW'],'zh-TW'],[['de','fr'],'zh'],[[], 'zh'],[[null,42,'en'],'en']])assert.equal(deviceLanguage(list),expected,JSON.stringify(list));
});
test('saved manual language wins at startup and applies the correct document language without writing',()=>{
 for(const [saved,language,tag]of [['zh','zh','zh-CN'],['zh-TW','zh-TW','zh-TW'],['en','en','en'],['zh-CN','zh','zh-CN'],['en-US','en','en']]){const f=fixture({saved,languages:['zh-HK','en']});assert.equal(f.preference.current.language,language);assert.equal(f.document.documentElement.lang,tag);assert.equal(f.preference.current.saved,true);assert.deepEqual(f.writes,[]);f.preference.close();}
});
test('first visits follow the device and invalid stored preferences are not silently overwritten',()=>{
 for(const saved of [undefined,'auto','invalid','{"lang":"en"}']){const f=fixture({saved,languages:['fr','en-GB']});assert.equal(f.preference.current.preference,'auto');assert.equal(f.preference.current.language,'en');assert.equal(f.document.documentElement.lang,'en');assert.equal(f.writes.length,0);f.preference.close();}
});
test('storage access failures keep startup, explicit manual choices and device mode usable',()=>{
 for(const opts of [{unavailable:true},{readFailure:true,writeFailure:true},{writeFailure:true}]){const f=fixture({...opts,languages:['en']});assert.equal(f.preference.current.language,'en');assert.equal(f.preference.set('zh-TW'),false);assert.equal(f.preference.current.language,'zh-TW');assert.equal(f.document.documentElement.lang,'zh-TW');f.navigator.languages=['zh-CN'];f.emit('languagechange');assert.equal(f.preference.current.language,'zh-TW');assert.equal(f.preference.set('auto'),false);assert.equal(f.preference.current.language,'zh');assert.equal(f.document.documentElement.lang,'zh-CN');f.preference.close();}
});
test('device changes update automatic choices and never overwrite a manual choice',()=>{
 const f=fixture({languages:['en']});f.navigator.languages=['zh-HK'];f.emit('languagechange');assert.equal(f.preference.current.language,'zh-TW');assert.equal(f.preference.set('en'),true);f.navigator.languages=['zh-CN'];f.emit('languagechange');assert.equal(f.preference.current.language,'en');assert.equal(f.preference.set('auto'),true);assert.equal(f.preference.current.language,'zh');assert.equal(f.values.has(LANGUAGE_KEY),false);assert.deepEqual(f.writes,[[LANGUAGE_KEY,'en'],[LANGUAGE_KEY,null]]);f.preference.close();
});
test('cross-tab updates re-read current storage, ignore unrelated keys and preserve a newer choice',()=>{
 const f=fixture({languages:['en']});f.values.set(LANGUAGE_KEY,'zh-TW');f.emit('storage',{key:LANGUAGE_KEY,newValue:'en',storageArea:f.storage});assert.equal(f.preference.current.language,'zh-TW');f.values.set(LANGUAGE_KEY,'en');f.emit('storage',{key:'qg:theme',storageArea:f.storage});assert.equal(f.preference.current.language,'zh-TW');f.emit('storage',{key:LANGUAGE_KEY,storageArea:{}});assert.equal(f.preference.current.language,'zh-TW');f.emit('storage',{key:LANGUAGE_KEY,storageArea:f.storage});assert.equal(f.preference.current.language,'en');f.values.clear();f.navigator.languages=['zh-HK'];f.emit('storage',{key:null,storageArea:f.storage});assert.equal(f.preference.current.preference,'auto');assert.equal(f.preference.current.language,'zh-TW');assert.equal(f.writes.length,0);f.preference.close();assert.equal(f.listeners.size,0);assert.equal(f.preference.set('zh'),false);
});
test('missing or restricted browser objects fall back without interrupting startup',()=>{
 const nav={get languages(){throw Error('Denied');},language:'en-US'},doc={documentElement:{lang:''}},p=createLanguagePreferences({storage:()=>undefined,navigator:nav,document:doc,events:null});assert.equal(p.current.language,'en');assert.equal(doc.documentElement.lang,'en');assert.equal(p.set('zh'),false);assert.equal(doc.documentElement.lang,'zh-CN');p.close();
});
test('invalid explicit choices leave the previous language unchanged and request headers follow only supported document tags',()=>{
 const f=fixture({saved:'zh-TW'});assert.equal(f.preference.set('unexpected'),false);assert.equal(f.preference.current.language,'zh-TW');assert.deepEqual(f.writes,[]);for(const lang of ['zh-CN','zh-TW','en','en-US'])assert.deepEqual(requestLanguageHeaders({documentElement:{lang}}),{'Accept-Language':lang});for(const lang of ['','../secret','en\r\nX: bad','fr'])assert.deepEqual(requestLanguageHeaders({documentElement:{lang}}),{});assert.deepEqual(requestLanguageHeaders(null),{});assert.equal(languagePreference({}),null);f.preference.close();
});
test('a manual choice that could not be saved survives older storage events and still reports a changed device',()=>{
 const f=fixture({saved:'zh',languages:['zh-CN'],writeFailure:true});assert.equal(f.preference.set('en'),false);f.emit('storage',{key:LANGUAGE_KEY,storageArea:f.storage});assert.equal(f.preference.current.language,'en');f.navigator.languages=['zh-HK'];f.emit('languagechange');assert.equal(f.preference.current.language,'en');assert.equal(f.preference.current.device,'zh-TW');for(const value of [null,undefined,{}])assert.equal(f.preference.set(value),false);assert.equal(f.preference.current.language,'en');f.preference.close();
});
