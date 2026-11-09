<template>
 <section class="qag-capabilities" :aria-label="pt('搭档能力档案')">
  <header class="qag-cap-heading"><span class="qag-cap-orb" aria-hidden="true"><ClientIcon name="spark" /><i></i><b>Q</b></span><div><span class="qag-eyebrow">QGAUSS / CAPABILITY COMPASS</span><h2>{{ pt('看看搭档的拿手好戏。') }}</h2><p>{{ pt('来自已保存的公开档案；具体执行以本轮返回为准。') }}</p></div><span class="qag-cap-coverage" :class="{'is-complete':report.complete}"><i></i>{{ pt(report.complete?'三类能力已提供':'部分资料待补齐') }}</span></header>
  <div class="qag-cap-grid"><article v-for="group in report.groups" :key="group.kind" class="qag-cap-card" :class="'qag-cap-'+group.kind">
   <header><span class="qag-cap-symbol" aria-hidden="true"><ClientIcon :name="labels[group.kind].icon" /></span><div><small>{{ labels[group.kind].eyebrow }}</small><h3>{{ pt(labels[group.kind].title) }}</h3></div><b class="qag-cap-count">{{ group.recorded===null?'—':group.recorded }}</b></header>
   <p class="qag-cap-state">{{ pt(group.status==='reported'?group.total?'已提供 {count} 项':'档案确认暂无配置':group.recorded?'已记录 {count} 项 · 清单待补齐':'资料尚未提供',{count:group.recorded}) }}</p>
   <ul v-if="group.items.length"><li v-for="(item,index) in group.items" :key="index"><span class="qag-cap-entry-dot" aria-hidden="true"></span><div><strong>{{ item.name }}</strong><p v-if="item.description">{{ item.description }}</p></div></li></ul>
   <div v-else class="qag-cap-placeholder"><ClientIcon :name="labels[group.kind].icon" /><p>{{ pt(group.status==='reported'?'目前没有可展示的项目。':group.recorded?'已有数量记录，名称待下次同步。':'档案补齐后，会在这里与你见面。') }}</p></div>
   <small v-if="group.truncated" class="qag-cap-foot">{{ pt('展示前 {shown} 项，共 {total} 项',{shown:group.items.length,total:group.total}) }}</small>
  </article></div>
  <footer><span><ClientIcon name="reasoning" />{{ pt('档案中的模型') }}<strong>{{ report.model||pt('模型信息尚未提供') }}</strong></span><small>{{ pt('能力清单用于了解搭档；打开档案不会调用工具或开始生成。') }}</small></footer>
 </section>
</template>
<script setup>
import {computed} from 'vue';
import {agentCapabilities} from '../../lib/agent-capabilities.js';
import {partnerText as pt} from '../../i18n/partner.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './agent-capabilities.css';
const props=defineProps({agent:Object}),report=computed(()=>agentCapabilities(props.agent));
const labels={tools:{title:'工具箱',eyebrow:'A LITTLE EXTRA REACH',icon:'settings'},workflows:{title:'工作流',eyebrow:'ONE STEP, THEN ANOTHER',icon:'connection'},knowledge:{title:'知识储备',eyebrow:'SOMETHING TO BUILD ON',icon:'reasoning'}};
</script>
