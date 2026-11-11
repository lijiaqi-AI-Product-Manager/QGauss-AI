import {computed,onBeforeUnmount,ref} from 'vue';
import {useAppearance} from '../stores/appearance.js';

export function useMotionPreference(){
 const appearance=useAppearance(),query=window.matchMedia?.('(prefers-reduced-motion: reduce)'),reduced=ref(!!query?.matches),change=event=>{reduced.value=event.matches;};
 query?.addEventListener?.('change',change);
 onBeforeUnmount(()=>query?.removeEventListener?.('change',change));
 return computed(()=>!appearance.motion||reduced.value);
}
