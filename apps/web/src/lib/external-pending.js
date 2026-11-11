import {externalPending} from './external-identity.js';
const storageKey=(owner,purpose)=>'qgauss:external:v1:'+encodeURIComponent(owner)+':'+purpose;
export function readExternalPending(owner,purpose,storage=globalThis.sessionStorage){try{return externalPending(JSON.parse(storage.getItem(storageKey(owner,purpose))||'null'),owner,purpose);}catch{return null;}}
export function saveExternalPending(owner,purpose,value,storage=globalThis.sessionStorage){
 try{const key=storageKey(owner,purpose);if(!value){storage.removeItem(key);return storage.getItem(key)===null;}const accepted=externalPending({...value,owner,purpose},owner,purpose);if(!accepted)return false;const text=JSON.stringify(accepted);storage.setItem(key,text);return storage.getItem(key)===text;}catch{return false;}
}
