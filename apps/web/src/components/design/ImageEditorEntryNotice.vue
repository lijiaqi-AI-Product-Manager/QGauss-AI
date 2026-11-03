<template>
 <section v-if="entry.present" class="qge-entry" :class="{blocked:entry.blocked}" :aria-label="pt(&quot;重绘设定带入创作&quot;)" :aria-busy="entry.pending"><div class="qge-entry-symbol"><QLoader v-if="entry.pending" :size="22"/><ClientIcon v-else name="palette"/></div><div class="qge-entry-copy"><span>QGAUSS / KEEP THE DETAILS YOU LOVE</span><strong>{{ entry.pending?pt("正在核对原图与选区…"):entry.applied?pt("重绘设定已就位。"):pt("继续这份画面里的新想法。") }}</strong><p v-if="entry.error" role="alert">{{ pt(entry.error) }}</p><p v-else-if="entry.offered">{{ pt("当前绘画草稿会被这份重绘设定替换。确认后带入原图、选区和描述，不会发起生成。") }}</p><p v-else>{{ pt("图片和选区已经带入，返回编辑时保留的绘画设置也已恢复。请确认模型、参数与费用，再点击生成。") }}</p></div><div class="qge-entry-actions"><button v-if="entry.offered&&!entry.pending&&!entry.error" type="button" @click="entry.confirm">{{ pt("带入这份重绘设定") }}</button><button v-if="entry.error&&!entry.pending" type="button" @click="entry.retry">{{ pt("重新核对") }}</button><button type="button" @click="entry.cancel">{{ entry.applied?pt("保留草稿，收起说明"):pt("保留当前草稿，暂不带入") }}</button></div></section>
</template>
<script setup>
import {paintingText as pt} from "../../i18n/painting.js";
import ClientIcon from '../reference/ClientIcon.vue';
import QLoader from '../QLoader.vue';
defineProps({entry:{type:Object,required:true}});
</script>
