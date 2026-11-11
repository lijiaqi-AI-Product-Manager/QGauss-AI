import {decodePhonePending} from './phone-identity.js';
const memories=new WeakMap();
function memory(){let value=memories.get(window);if(!value){value=new Map();memories.set(window,value);}return value;}
const keyFor=(kind,owner,purpose)=>'qg:phone-'+kind+':'+owner+':'+purpose;
export function readPhonePending(kind,owner,purpose){const key=keyFor(kind,owner,purpose);let value;try{value=sessionStorage.getItem(key);memory().delete(key);}catch{value=memory().get(key);}return value?decodePhonePending(value,owner,purpose):null;}
export function savePhonePending(kind,owner,purpose,pending){const key=keyFor(kind,owner,purpose),value=pending?JSON.stringify({version:1,owner,purpose,key:pending.key,operationVersion:pending.operationVersion}):null;try{if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);memory().delete(key);}catch{if(value)memory().set(key,value);else memory().delete(key);}}
