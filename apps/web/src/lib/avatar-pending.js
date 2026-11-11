import {decodeAvatarPending} from './profile-avatar.js';
const scopes=new WeakMap();
function memory(){const target=typeof window==='object'?window:globalThis;if(!scopes.has(target))scopes.set(target,new Map());return scopes.get(target);}
const key=id=>'qg:avatar-pending:'+id;
export function readAvatarPending(id){const saved=memory().get(id);let value;try{value=saved?.volatile?saved.value:sessionStorage.getItem(key(id));if(value===null)memory().delete(id);}catch{value=saved?.value;}return decodeAvatarPending(value,id);}
export function saveAvatarPending(id,row){if(!row){memory().delete(id);try{sessionStorage.removeItem(key(id));}catch{}return;}const value=JSON.stringify({version:1,owner:id,key:row.key,operationVersion:row.operationVersion});let volatile=false;try{sessionStorage.setItem(key(id),value);}catch{volatile=true;}memory().set(id,{value,volatile});}
