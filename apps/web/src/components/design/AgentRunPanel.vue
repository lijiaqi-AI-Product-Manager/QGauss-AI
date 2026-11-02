<template>
  <section v-if="report" class="qag-run" aria-label="智能体协作进度">
    <header><span class="qag-mini-core" :class="{'is-working':['waiting','running'].includes(report.status)}" aria-hidden="true">Q</span><div><strong>{{ agentRunTitle(report) }}</strong><small>{{ report.context==='continued' ? '沿着当前分支接着聊' : '本轮使用独立的服务方会话' }}</small></div><ClientIcon :name="report.status==='completed'?'check':'spark'" /></header>
    <ol v-if="report.steps.length"><li v-for="(step,index) in report.steps" :key="index"><span class="qag-step-dot"></span><span>{{ step.label }}</span><small>{{ step.state==='returned'?'已收到返回':['waiting','running'].includes(report.status)?'正在调用':'返回未确认' }}</small></li></ol>
    <p v-if="report.cancellation" class="qag-cancel-note">{{ report.cancellation==='accepted' ? '服务方已接受取消请求。服务方的计算或用量可能仍会继续，本站保留本轮中断状态。' : report.cancellation==='unknown' ? '已停止本站接收，服务方取消结果暂未确认；不会自动重新发起对话。' : '正在向服务方提交取消请求…' }}</p>
    <div v-if="report.artifacts.length" class="qag-artifacts" aria-label="智能体返回的附件"><a v-for="artifact in report.artifacts" :key="artifact.url" :href="artifact.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><ClientIcon :name="artifact.kind==='image'?'image':'file'" /><span>{{ artifact.title }}</span><ClientIcon name="arrowUpRight" /></a><small>由搭档服务提供，点击后打开；链接可能有有效期。</small></div>
    <div v-if="report.suggestions.length && report.status==='completed'" class="qag-followups" aria-label="智能体建议的后续问题"><small>顺着灵感，继续一步</small><button v-for="question in report.suggestions" :key="question" type="button" :disabled="disabled" @click="emit('select',question)">{{ question }}<ClientIcon name="arrowUpRight" /></button><p>点击只会填入问题，由你决定是否发送。</p></div>
  </section>
</template>
<script setup>
import {computed} from 'vue';
import {agentRunReport,agentRunTitle} from '../../lib/agent-presentation.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './agent-space.css';
import './agent-chat.css';
const props=defineProps({value:Object,disabled:Boolean}),emit=defineEmits(['select']);
const report=computed(()=>agentRunReport(props.value));
</script>
