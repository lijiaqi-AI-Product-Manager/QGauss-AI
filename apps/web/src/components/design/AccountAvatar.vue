<template>
  <span class="qac-avatar" :class="['qac-avatar-' + choice.tone,{'has-photo':!!url}]" :style="{ '--qac-avatar-size': size + 'px' }" :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : ct(custom?'自定义头像':choice.name)" :aria-hidden="decorative ? 'true' : undefined" :aria-busy="state==='loading'"><img v-if="url" :src="url" alt="" draggable="false" referrerpolicy="no-referrer" @load="state='ready'" @error="failed"/><span v-else class="qac-avatar-face"><i></i><i></i><b></b></span><span v-if="state==='loading'" class="qac-photo-loader" aria-hidden="true"></span><span class="qac-avatar-glint"></span></span>
</template>
<script setup>
import {currentLang} from '../../i18n/index.js';
import {accountText} from '../../i18n/account-messages.js';
const ct=(key,params)=>accountText(currentLang.value,key,params);
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import { accountAvatar } from '../../lib/account-profile.js';
import {avatarImagePath,legacyAvatarUrl} from '../../lib/profile-avatar.js';
import {fetchBlob} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {useMotionPreference} from '../../composables/useMotionPreference.js';
const props = defineProps({ value: String, size: { type: Number, default: 48 }, decorative: Boolean });
const choice = computed(() => accountAvatar(props.value));
const auth=useAuth(),quiet=useMotionPreference(),url=ref(''),state=ref('idle'),custom=computed(()=>!!(avatarImagePath(props.value)||legacyAvatarUrl(props.value)));let controller,revision=0,objectUrl='';
function clear(){controller?.abort();controller=null;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl='';url.value='';}
function failed(){clear();state.value='error';}
watch([()=>props.value,()=>auth.user?.id,()=>auth.identityRevision,quiet],async()=>{const at=++revision;clear();if(!auth.isLoggedIn){state.value='idle';return;}const path=avatarImagePath(props.value),legacy=legacyAvatarUrl(props.value);if(!path){url.value=legacy;state.value=legacy?'loading':'idle';return;}controller=new AbortController();state.value='loading';try{const blob=await fetchBlob(path+(quiet.value?'?still=1':''),{signal:controller.signal,retry:false});if(at!==revision)return;if(!['image/png','image/webp','image/gif'].includes(blob.type))throw Error();objectUrl=URL.createObjectURL(blob);url.value=objectUrl;}catch{if(at===revision)failed();}},{immediate:true,flush:'post'});
onBeforeUnmount(()=>{revision++;clear();});
</script>
<style scoped>
.qac-avatar{--qac-avatar-light:#bdacff;--qac-avatar-dark:#7550db;position:relative;display:inline-grid;place-items:center;flex:0 0 auto;isolation:isolate;width:var(--qac-avatar-size);height:var(--qac-avatar-size);border-radius:32%;background:radial-gradient(circle at 24% 18%,#fff9,transparent 45%),linear-gradient(145deg,var(--qac-avatar-light),var(--qac-avatar-dark));box-shadow:inset 2px 3px 4px #fff7,inset -3px -4px 5px #25203d29,0 8px 14px -7px var(--qac-avatar-dark);transform:rotate(-5deg)}
.qac-avatar-lime{--qac-avatar-light:#e1f9a0;--qac-avatar-dark:#719e32}.qac-avatar-coral{--qac-avatar-light:#ffc7b0;--qac-avatar-dark:#e4778d}.qac-avatar-orbit{--qac-avatar-light:#93cbef;--qac-avatar-dark:#6656b5}
.qac-avatar-face{position:relative;display:flex;justify-content:center;gap:14%;width:70%;height:48%;padding-top:8%;border-radius:40%;background:#ffffff24;box-shadow:inset 0 0 1px #fff7}.qac-avatar-face i{width:13%;height:54%;border-radius:99px;background:#fff;box-shadow:0 1px 3px #38365830}.qac-avatar-face b{position:absolute;bottom:13%;left:40%;width:20%;height:17%;border-radius:0 0 99px 99px;background:#fff9}.qac-avatar-glint{position:absolute;left:14%;top:13%;width:24%;height:8%;border-radius:99px;background:#ffffff70;transform:rotate(-24deg)}
.qac-avatar>img{position:absolute;inset:3px;width:calc(100% - 6px);height:calc(100% - 6px);object-fit:cover;border-radius:30%;background:var(--qd-surface)}.qac-avatar.has-photo .qac-avatar-glint{opacity:.3}.qac-photo-loader{position:absolute;inset:18%;border:2px solid #fff4;border-top-color:#fff;border-radius:50%;animation:qac-photo-spin .85s linear infinite}@keyframes qac-photo-spin{to{rotate:360deg}}[data-qg-motion=quiet] .qac-photo-loader{animation:none}@media(prefers-reduced-motion:reduce){.qac-photo-loader{animation:none}}
</style>
