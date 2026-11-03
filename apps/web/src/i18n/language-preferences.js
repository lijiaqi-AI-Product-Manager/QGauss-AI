export const LANGUAGE_KEY='qg:lang';
export const LANGUAGE_OPTIONS=Object.freeze([
 Object.freeze({key:'zh',tag:'zh-CN',title:'简体中文'}),
 Object.freeze({key:'zh-TW',tag:'zh-TW',title:'繁體中文'}),
 Object.freeze({key:'en',tag:'en',title:'English'}),
]);

export function languagePreference(value){
 if(value==='auto'||value===null||value===undefined)return'auto';
 if(value==='zh'||value==='zh-CN')return'zh';
 if(value==='zh-TW')return'zh-TW';
 if(value==='en'||value==='en-US')return'en';
 return null;
}
export function deviceLanguage(values){
 for(const value of Array.isArray(values)?values:[]){
  if(typeof value!=='string'||!value||value.length>128)continue;
  try{const locale=new Intl.Locale(value);if(locale.language==='en')return'en';if(locale.language==='zh'){if(locale.script)return locale.script==='Hant'?'zh-TW':'zh';return['TW','HK','MO'].includes(locale.region)?'zh-TW':'zh';}}catch{ /* Ignore malformed browser entries and continue in preference order. */ }
 }
 return'zh';
}
export function browserLanguages(navigator){
 const values=[];try{if(Array.isArray(navigator?.languages))values.push(...navigator.languages.slice(0,30));}catch{}
 try{if(navigator?.language)values.push(navigator.language);}catch{}
 return values;
}
export function languageTag(language){return LANGUAGE_OPTIONS.find(item=>item.key===language)?.tag||'zh-CN';}

/** Browser objects are injected so storage restrictions never become an import failure. */
export function createLanguagePreferences({storage=()=>globalThis.localStorage,navigator=globalThis.navigator,document=globalThis.document,events=globalThis.window,onChange=()=>{}}={}){
 let state,closed=false;
 function read(){try{const target=storage();if(!target)return{preference:'auto',saved:false};return{preference:languagePreference(target.getItem(LANGUAGE_KEY))||'auto',saved:true};}catch{return{preference:'auto',saved:false};}}
 function apply(preference,saved){
  const device=deviceLanguage(browserLanguages(navigator)),language=preference==='auto'?device:preference;
  state=Object.freeze({preference,language,device,saved});
  try{if(document?.documentElement)document.documentElement.lang=languageTag(language);}catch{}
  if(!closed)onChange(state);return state;
 }
 const initial=read();apply(initial.preference,initial.saved);
 function set(value){
  if(typeof value!=='string')return false;const preference=languagePreference(value);if(closed||!preference)return false;let saved=false;
  try{const target=storage();if(!target)throw Error('Storage unavailable');if(preference==='auto')target.removeItem(LANGUAGE_KEY);else target.setItem(LANGUAGE_KEY,preference);saved=true;}catch{}
  apply(preference,saved);return saved;
 }
 function onDeviceChange(){if(!closed)apply(state.preference,state.saved);}
 function onStorage(event){
  if(closed||!state.saved&&state.preference!=='auto'||event.key!==LANGUAGE_KEY&&event.key!==null)return;
  try{const target=storage();if(!target||event.storageArea&&event.storageArea!==target)return;const preference=languagePreference(target.getItem(LANGUAGE_KEY))||'auto';apply(preference,true);}catch{ /* Keep the current in-memory choice when storage cannot be read. */ }
 }
 events?.addEventListener?.('languagechange',onDeviceChange);events?.addEventListener?.('storage',onStorage);
 return{get current(){return state;},set,close(){if(closed)return;closed=true;events?.removeEventListener?.('languagechange',onDeviceChange);events?.removeEventListener?.('storage',onStorage);}};
}

/** Request errors follow the visible interface, including an unsaved manual choice. */
export function requestLanguageHeaders(document=globalThis.document){
 try{const tag=document?.documentElement?.lang;if(['zh-CN','zh-TW','en','en-US'].includes(tag))return{'Accept-Language':tag};}catch{}
 return{};
}
