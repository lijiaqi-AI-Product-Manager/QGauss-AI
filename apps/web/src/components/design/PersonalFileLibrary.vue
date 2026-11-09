<template>
 <dialog ref="dialog" class="qfl-dialog" :aria-label="ct('我的创作文件')" @cancel.prevent="emit('close')" @click="onBackdrop">
  <section class="qfl-library">
   <header><span class="qfl-sculpture" aria-hidden="true"><ClientIcon name="folder"/><i>Q</i></span><div><small>QGAUSS / YOUR IDEAS, KEPT CLOSE</small><h2>{{ ct('我的创作文件') }}</h2><p>{{ ct('把好成果留下，再带进下一次创作。') }}</p></div><button class="qfl-close" type="button" :aria-label="ct('关闭个人文件')" @click="emit('close')"><ClientIcon name="close"/></button></header>
   <nav class="qfl-tabs" :aria-label="ct('文件范围')"><button type="button" :aria-pressed="tab==='active'" @click="emit('tab','active')">{{ ct('可用文件') }}</button><button type="button" :aria-pressed="tab==='trash'" @click="emit('tab','trash')">{{ ct('回收站') }}</button></nav>
   <form class="qfl-search" @submit.prevent="emit('search',query)"><ClientIcon name="search"/><input v-model="query" type="search" maxlength="100" :aria-label="ct('搜索个人文件')" :placeholder="ct('寻找一个文件名…')"/><button type="submit">{{ ct('搜索') }}</button></form>
   <div class="qfl-filter"><button v-for="item in filters" :key="item.value" type="button" :aria-pressed="kind===item.value" @click="emit('kind',item.value)">{{ ct(item.label) }}</button><button class="qfl-refresh" type="button" :disabled="loading" @click="emit('refresh')"><ClientIcon name="refresh"/>{{ ct('刷新') }}</button></div>
   <div v-if="error" class="qfl-notice" role="alert"><p>{{ ct(error) }}</p><button type="button" :disabled="loading" @click="emit('refresh')">{{ ct('重新核对') }}</button></div>
   <div v-if="loading&&!items.length" class="qfl-empty" role="status"><BrandLoader :size="42" :text="ct('正在打开你的文件…')"/></div>
   <div v-else-if="!items.length&&!error" class="qfl-empty"><span aria-hidden="true">✧</span><h3>{{ ct(tab==='trash'?'这里还没有移出的文件':'给好成果，留一个位置。') }}</h3><p>{{ ct(tab==='trash'?'从个人文件移出的内容，会在这里等待你找回。':'保存搭档成果或上传附件后，可在这里继续使用。') }}</p></div>
   <div v-else class="qfl-grid" :aria-busy="loading">
    <article v-for="file in items" :key="file.id" class="qfl-card">
     <span class="qfl-file-art" :class="{'is-image':file.mime?.startsWith('image/')}" aria-hidden="true"><ClientIcon :name="file.mime?.startsWith('image/')?'image':'file'"/><i>Q</i></span><div class="qfl-file-copy"><small>{{ ct(file.scope==='agent-result'?'保存的搭档成果':'上传的附件') }}</small><h3>{{ file.filename }}</h3><p>{{ sizeLabel(file.size) }} · {{ dateLabel(file.createdAt) }}</p></div>
     <footer v-if="tab==='active'"><button type="button" :disabled="busyId===file.id" @click="emit('download',file)"><ClientIcon name="download"/>{{ ct('下载') }}</button><button type="button" :disabled="disabled||busyId===file.id" @click="emit('select',file.id)"><ClientIcon name="plus"/>{{ ct('带入对话') }}</button><button class="qfl-trash" type="button" :disabled="busyId===file.id||!Number.isSafeInteger(file.version)" :aria-label="ct('移到回收站：{name}',{name:file.filename})" @click="emit('trash',file)"><ClientIcon name="trash"/></button></footer>
     <footer v-else><button type="button" :disabled="busyId===file.id||!file.restorable||!Number.isSafeInteger(file.version)" @click="emit('restore',file)"><ClientIcon name="refresh"/>{{ ct('恢复文件') }}</button><small v-if="!file.restorable">{{ ct('原文件暂不可恢复') }}</small></footer>
    </article>
   </div>
   <footer class="qfl-pagination"><span>{{ ct('共 {count} 个文件',{count:total}) }}</span><button type="button" :disabled="loading||page<=1" @click="emit('page',page-1)">{{ ct('上一页') }}</button><span>{{ page }} / {{ Math.max(1,Math.ceil(total/20)) }}</span><button type="button" :disabled="loading||page*20>=total" @click="emit('page',page+1)">{{ ct('下一页') }}</button></footer>
   <p class="qfl-footnote">{{ ct(tab==='trash'?'移到回收站的文件不能下载或带入对话；恢复后可再次使用。':'选择文件只会放进编辑区，由你决定是否发送。') }}</p>
  </section>
 </dialog>
</template>
<script setup>
import{ref,watch,onMounted,onBeforeUnmount}from'vue';import{chatText as ct}from'../../i18n/chat.js';import{currentLang}from'../../i18n/index.js';import ClientIcon from'../reference/ClientIcon.vue';import BrandLoader from'./BrandLoader.vue';import'./agent-files.css';
const props=defineProps({open:Boolean,items:{type:Array,default:()=>[]},loading:Boolean,error:String,tab:{type:String,default:'active'},kind:{type:String,default:'all'},page:{type:Number,default:1},total:{type:Number,default:0},busyId:String,disabled:Boolean}),emit=defineEmits(['close','tab','kind','search','page','refresh','download','select','trash','restore']),dialog=ref(null),query=ref('');
const filters=[{value:'all',label:'全部'},{value:'image',label:'图片'},{value:'file',label:'文档与文件'}];
watch(()=>props.open,open=>{if(open){query.value='';if(dialog.value&&!dialog.value.open)dialog.value.showModal();}else dialog.value?.close();},{flush:'post'});
function onBackdrop(event){if(event.target===dialog.value)emit('close');}
function sizeLabel(value){if(!Number.isFinite(value)||value<0)return ct('大小待确认');return value>=1048576?(value/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(value/1024))+' KB';}
function dateLabel(value){const time=new Date(value);if(!Number.isFinite(time.getTime()))return ct('日期待确认');return new Intl.DateTimeFormat(currentLang.value==='en'?'en':currentLang.value==='zh-TW'?'zh-TW':'zh-CN',{dateStyle:'medium'}).format(time);}
onBeforeUnmount(()=>dialog.value?.close());
onMounted(()=>{if(props.open&&!dialog.value.open)dialog.value.showModal();});
</script>
