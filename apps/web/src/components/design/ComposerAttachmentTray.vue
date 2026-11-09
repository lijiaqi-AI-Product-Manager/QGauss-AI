<template>
 <section v-if="items.length" class="cv-pending qca-tray" :aria-label="ct('这次对话的附件')">
  <header><span><ClientIcon name="folder"/>{{ ct('这次对话的附件') }} <b>{{ items.length }}/9</b></span><small>{{ ct(checking?'正在核对文件，草稿会留在这里。':'移出编辑区不会删除个人文件。') }}</small></header>
  <div class="qca-grid">
   <article v-for="file in items" :key="file.localId" class="cv-pending-item qca-file" :class="file.status" :data-file-state="file.status" :title="file.error?ct(file.error):file.name">
    <span class="qca-file-art" :class="{'is-image':file.kind==='image'}"><img v-if="file.kind==='image'&&file.preview" :src="file.preview" :alt="file.name"/><ClientIcon v-else :name="file.kind==='image'?'image':'file'"/><i v-if="!file.preview" aria-hidden="true">Q</i></span>
    <div class="qca-file-copy"><strong class="cv-pending-name">{{ file.name }}</strong><span class="cv-pending-state" role="status"><BrandLoader v-if="busy(file)" :size="15"/><ClientIcon v-else :name="file.status==='done'?'check':'info'"/>{{ ct(label(file.status)) }}</span><small>{{ size(file.size) }}</small></div>
    <button class="cv-pending-x qca-remove" type="button" :aria-label="ct('从编辑区移除：{name}',{name:file.name})" @click="emit('remove',file)"><ClientIcon name="close"/></button>
    <p v-if="file.error" class="qca-error" role="alert">{{ ct(file.error) }}</p>
    <div v-if="['unknown','check-failed','error','unavailable'].includes(file.status)" class="qca-actions"><button v-if="['unknown','check-failed'].includes(file.status)" type="button" :disabled="checking" @click="emit('check',file)"><ClientIcon name="refresh"/>{{ ct(file.id?'重新核对文件':'核对上传结果') }}</button><button v-else-if="file.status==='error'&&file.canRetry" type="button" :disabled="checking" @click="emit('retry',file)"><ClientIcon name="refresh"/>{{ ct('重新上传原文件') }}</button><button v-else-if="file.status==='error'" type="button" @click="emit('choose',file)"><ClientIcon name="plus"/>{{ ct('重新选择原文件') }}</button><button v-if="file.status==='unavailable'" type="button" @click="emit('library')"><ClientIcon name="folder"/>{{ ct('打开个人文件') }}</button></div>
    <span v-if="busy(file)" class="qca-transfer" aria-hidden="true"><i/></span>
   </article>
  </div>
 </section>
</template>
<script setup>
import {chatText as ct} from '../../i18n/chat.js';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import './composer-attachments.css';
defineProps({items:{type:Array,default:()=>[]},checking:Boolean});const emit=defineEmits(['remove','retry','check','choose','library']);
const busy=file=>['queued','uploading','checking','storing','verifying'].includes(file.status);
const label=status=>({queued:'正在排队，稍后上传',uploading:'正在上传原文件',checking:'正在核对上传结果',storing:'已收到文件，正在保存',verifying:'正在核对上次上传',done:'文件已就绪',unknown:'上传结果暂未确认','check-failed':'文件状态暂未确认',error:'上传未完成',unavailable:'这份文件暂不可用'})[status]||'文件状态暂未确认';
function size(value){return Number.isFinite(value)&&value>=1048576?(value/1048576).toFixed(1)+' MB':Number.isFinite(value)?Math.max(1,Math.ceil(value/1024))+' KB':'';}
</script>
