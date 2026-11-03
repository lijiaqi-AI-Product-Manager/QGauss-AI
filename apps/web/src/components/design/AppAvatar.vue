<template>
 <span class="qai-avatar" :data-state="state" :aria-busy="state==='loading'" :role="label?'img':undefined" :aria-label="label||undefined" :aria-hidden="label?undefined:true">
  <img v-if="url" :src="url" alt="" draggable="false" @load="loaded" @error="failed"/>
  <span v-else-if="state==='loading'" class="qai-avatar-loader"></span>
  <span v-else class="qai-avatar-fallback">{{ fallback }}</span>
 </span>
</template>
<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {fetchBlob} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {appImageId,appImagePath} from '../../lib/app-image.js';
import './app-image.css';
const props=defineProps({icon:String,appId:String,privateImage:Boolean,label:String});
const emit=defineEmits(['state']);
const auth=useAuth(),url=ref(''),state=ref('idle');let controller,revision=0;
const fallback=computed(()=>['🪐','🎨','🧠','📝','🧭','💻'].includes(props.icon)?props.icon:appImageId(props.icon)?'✦':'🪐');
function setState(value){state.value=value;emit('state',value);}
function clear(){controller?.abort();controller=null;if(url.value)URL.revokeObjectURL(url.value);url.value='';}
function loaded(){setState('ready');}
function failed(){clear();setState('error');}
watch([()=>props.icon,()=>props.appId,()=>props.privateImage,()=>auth.user?.id,()=>auth.identityRevision],async()=>{
 const current=++revision;clear();const path=appImagePath(props.icon,props.appId,props.privateImage);
 if(!path){setState('idle');return;}setState('loading');controller=new AbortController();
 try{const blob=await fetchBlob(path,{signal:controller.signal,retry:false});if(current!==revision)return;if(blob.type!=='image/png')throw Error('图片格式不可用');url.value=URL.createObjectURL(blob);}
 catch{if(current===revision)setState('error');}
},{immediate:true});
onBeforeUnmount(()=>{revision++;clear();});
</script>
