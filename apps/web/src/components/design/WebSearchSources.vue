<template>
  <section v-if="report" class="qws-sources" :class="['qws-'+appearance.variant,'qws-'+report.status]" :aria-label="ct(&quot;联网检索与资料来源&quot;)">
    <header><span class="qws-globe" aria-hidden="true"><i></i><b></b></span><div><strong>{{ ct(webSearchLabel(report)) }}</strong><span>{{ ct(description) }}</span></div><span v-if="report.sources.length" class="qws-count">{{ ct("{p0} 个来源",{p0:(report.sources.length)}) }}</span></header>
    <details v-if="report.sources.length" :open="report.sources.length<=3&&!streaming"><summary>{{ ct("查看资料与链接 ") }}<ClientIcon name="chevronRight" /></summary><ol><li v-for="(item,index) in report.sources" :key="item.url"><a :href="item.url" target="_blank" rel="noopener noreferrer nofollow"><span class="qws-number">{{ index+1 }}</span><span><strong>{{ item.title || item.domain }}</strong><small>{{ item.domain }}</small></span><ClientIcon name="arrowUpRight" /></a></li></ol><p>{{ ct("来源由模型服务提供，链接不代表内容已经核实；请打开原文确认。") }}</p></details>
  </section>
</template>
<script setup>
import {chatText as ct} from "../../i18n/chat.js";
import { computed } from 'vue';
import { useAppearance } from '../../stores/appearance.js';
import { webSearchReport,webSearchLabel } from '../../lib/web-search.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './web-search.css';
const props=defineProps({value:Object,streaming:Boolean}),appearance=useAppearance();
const report=computed(()=>webSearchReport(props.value));
const description=computed(()=>['requested','searching'].includes(report.value?.status)?'由模型按需要查找资料，请稍候。':report.value?.status==='complete'?'可以沿着下面的来源，继续确认答案。':report.value?.status==='no_sources'?'模型没有返回来源，无法据此确认是否实际检索。':report.value?.status==='interrupted'?'保留已返回的资料，结果尚未完整；请打开来源核对。':'可调整问题或配置后，明确发起新的回复。');
</script>
