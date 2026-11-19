import{computed,onBeforeUnmount,ref,watch}from'vue';
import{api}from'../api/client.js';
import{useAuth}from'../stores/auth.js';
import{fallbackNavigation,navigationSnapshot,navigationSurface}from'../lib/navigation.js';
import{subscribeNavigationChanges}from'../lib/navigation-changes.js';
export function useMenuNavigation(commerce,enabled={value:true}){
 const auth=useAuth(),items=ref([]),loading=ref(false),error=ref(''),known=ref(false),role=ref(auth.user?.role||'GUEST'),media=window.matchMedia('(max-width:760px)'),platform=ref(media.matches?'mobile':'desktop');let alive=true,epoch=0,request=null;
 const context=()=>[auth.user?.id||'',auth.identityRevision,auth.user?.role||'GUEST'].join(':'),current=(at,n)=>alive&&context()===at&&epoch===n;
 async function refresh(){if(!enabled.value)return;const at=context(),n=++epoch;request?.abort();request=new AbortController();const controller=request;loading.value=true;error.value='';try{const value=navigationSnapshot(await api.get('/menus/navigation?platform='+platform.value,{signal:controller.signal}),auth.user?.id||null);if(current(at,n)){items.value=value.items;role.value=value.role;known.value=true;}}catch(e){if(current(at,n)&&e.name!=='AbortError')error.value='导航暂时无法更新，当前页面仍可继续。';}finally{if(current(at,n))loading.value=false;}}
 const source=computed(()=>{const rows=known.value?items.value:fallbackNavigation(auth.user?.role||'GUEST',commerce.value,platform.value);function filter(list){return list.filter(row=>commerce.value||!row.commerce).map(row=>({...row,children:filter(row.children||[])}));}return filter(rows);});
 const client=computed(()=>navigationSurface(source.value,'client',platform.value)),manage=computed(()=>navigationSurface(source.value,'manage',platform.value));
 watch(()=>[auth.user?.id,auth.user?.role,auth.identityRevision,enabled.value],()=>{epoch++;request?.abort();items.value=[];known.value=false;role.value=auth.user?.role||'GUEST';error.value='';if(enabled.value)void refresh();},{immediate:true,flush:'sync'});
 watch(commerce,()=>{if(enabled.value)void refresh();});
 const updateDevice=()=>{platform.value=media.matches?'mobile':'desktop';void refresh();};media.addEventListener('change',updateDevice);const stop=subscribeNavigationChanges(()=>refresh());
 onBeforeUnmount(()=>{alive=false;epoch++;request?.abort();stop();media.removeEventListener('change',updateDevice);});return{client,manage,items,known,role,platform,loading,error,refresh};
}
