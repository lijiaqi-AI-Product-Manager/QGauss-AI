<template>
 <article class="qag-result-card" :data-save-state="receipt?.status||'unavailable'">
  <a class="qag-result-open" :href="artifact.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><span class="qag-result-art" :class="'is-'+artifact.kind" aria-hidden="true"><ClientIcon :name="artifact.kind==='image'?'image':'file'"/><i>Q</i></span><span class="qag-result-copy"><small>{{ ct(artifact.kind==='image'?'图片成果':'文件成果') }}</small><strong>{{ artifact.title }}</strong><span>{{ host }}</span><em>{{ ct(artifact.kind==='image'?'打开图片':'打开文件') }}<ClientIcon name="arrowUpRight"/></em></span></a>
  <footer v-if="artifact.key&&messageId" class="qag-save-footer">
   <p role="status"><BrandLoader v-if="active||checking" :size="17"/><ClientIcon v-else :name="receipt?.status==='saved'?'check':receipt?.status==='failed'?'info':'folder'"/><span>{{ ct(statusLabel) }}</span></p>
   <div v-if="receipt?.status==='saved'&&receipt.file" class="qag-save-actions"><button type="button" :disabled="downloading" @click="emit('download',receipt.file)"><ClientIcon name="download"/>{{ ct(downloading?'正在准备下载…':'下载文件') }}</button><button type="button" :disabled="disabled" @click="emit('reuse',receipt.file.id)"><ClientIcon name="plus"/>{{ ct('带入对话') }}</button></div>
   <button v-else-if="receipt?.status==='trashed'" class="qag-save-button" type="button" @click="emit('library','trash')"><ClientIcon name="folder"/>{{ ct('查看回收站') }}</button>
   <button v-else-if="receipt?.status==='unknown'||checkingError||!receipt&&!checking" class="qag-save-button" type="button" :disabled="checking" @click="emit('refresh')"><ClientIcon name="refresh"/>{{ ct('核对保存记录') }}</button>
   <button v-else class="qag-save-button" type="button" :disabled="disabled||active||checking||!receipt" @click="emit('save',artifact.key)"><ClientIcon name="save"/>{{ ct(active?'正在保存…':receipt?.status==='failed'||receipt?.status==='removed'?'重新保存':'保存到我的文件') }}</button>
   <small v-if="receipt?.error" class="qag-save-error" role="alert">{{ ct(receipt.error) }}</small>
  </footer>
 </article>
</template>
<script setup>
import{computed}from'vue';import{chatText as ct}from'../../i18n/chat.js';import ClientIcon from'../reference/ClientIcon.vue';import BrandLoader from'./BrandLoader.vue';import'./agent-files.css';
const props=defineProps({artifact:{type:Object,required:true},messageId:String,receipt:Object,checking:Boolean,checkingError:Boolean,disabled:Boolean,downloading:Boolean}),emit=defineEmits(['save','refresh','download','reuse','library']);
const active=computed(()=>['queued','fetching','storing','verifying'].includes(props.receipt?.status));
const host=computed(()=>{try{return new URL(props.artifact.url).hostname;}catch{return '';}});
const statusLabel=computed(()=>props.checking?'正在核对保存状态…':props.checkingError?'保存状态暂未确认':({unsaved:'远程成果链接 · 尚未保存',queued:'已收到保存请求，正在准备',fetching:'正在取回原成果',storing:'正在存入个人文件',verifying:'正在核对原保存结果',saved:'已保存到个人文件',failed:'这次保存未能完成',removed:'保存的文件已不可用',trashed:'文件已移到回收站',unknown:'保存结果暂未确认'})[props.receipt?.status]||'保存入口暂不可用');
</script>
