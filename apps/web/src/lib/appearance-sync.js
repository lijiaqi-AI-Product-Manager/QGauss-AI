import {APPEARANCE_STORAGE_KEY} from '../stores/appearance.js';
import {THEME_STORAGE_KEY} from '../stores/theme.js';

/** Read the latest preference without writing it back to other open pages. */
export function bindAppearanceSync(appearance,theme,target=window){
  const update=event=>{
    try{if(event.storageArea&&event.storageArea!==target.localStorage)return;}catch{return;}
    if(event.key===null||event.key===APPEARANCE_STORAGE_KEY)appearance.syncFromStorage();
    if(event.key===null||event.key===THEME_STORAGE_KEY)theme.syncFromStorage();
  };
  target.addEventListener('storage',update);
  return()=>target.removeEventListener('storage',update);
}
