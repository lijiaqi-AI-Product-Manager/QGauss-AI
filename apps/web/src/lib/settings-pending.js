import {decodeSettingsPending} from './settings-workspace.js';
const memories=new WeakMap();
function memory(){let value=memories.get(window);if(!value){value=new Map();memories.set(window,value);}return value;}
const keyFor=owner=>'qg:settings-operation:'+owner;
export function readSettingsPending(owner){const key=keyFor(owner);let raw;try{raw=sessionStorage.getItem(key);memory().delete(key);}catch{raw=memory().get(key);}return raw?decodeSettingsPending(raw,owner):null;}
export function saveSettingsPending(owner,pending){const key=keyFor(owner),raw=pending?JSON.stringify({version:1,owner,key:pending.key,operationVersion:pending.operationVersion}):null;try{if(raw)sessionStorage.setItem(key,raw);else sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==raw){if(raw)memory().set(key,raw);return false;}memory().delete(key);return true;}catch{if(raw)memory().set(key,raw);else memory().delete(key);return false;}}
