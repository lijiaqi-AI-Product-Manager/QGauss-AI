<template>
  <section v-if="report" class="qag-run" :aria-label="ct(&quot;智能体协作进度&quot;)">
    <header><span class="qag-mini-core" :class="{'is-working':['waiting','running'].includes(report.status)}" aria-hidden="true">Q</span><div><strong>{{ ct(agentRunTitle(report)) }}</strong><small>{{ report.context==='continued' ? ct("沿着当前分支接着聊") : ct("本轮使用独立的服务方会话") }}</small></div><ClientIcon :name="report.status==='completed'?'check':'spark'" /></header>
    <ol v-if="report.steps.length"><li v-for="(step,index) in report.steps" :key="index"><span class="qag-step-dot"></span><span>{{ step.label }}</span><small>{{ step.state==='returned'?ct("已收到返回"):['waiting','running'].includes(report.status)?ct("正在调用"):ct("返回未确认") }}</small></li></ol>
    <p v-if="report.cancellation" class="qag-cancel-note">{{ report.cancellation==='accepted' ? ct("服务方已接受取消请求。服务方的计算或用量可能仍会继续；本轮结果与费用以当前回执为准。") : report.cancellation==='unknown' ? ct("已停止本站接收，服务方取消结果暂未确认；不会自动重新发起对话。") : ct("正在向服务方提交取消请求…") }}</p>
    <div v-if="report.artifacts.length" class="qag-artifacts" :aria-label="ct(&quot;智能体返回的附件&quot;)"><a v-for="artifact in report.artifacts" :key="artifact.url" :href="artifact.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><ClientIcon :name="artifact.kind==='image'?'image':'file'" /><span>{{ artifact.title }}</span><ClientIcon name="arrowUpRight" /></a><small>{{ ct("由搭档服务提供，点击后打开；链接可能有有效期。") }}</small></div>
    <div v-if="report.suggestions.length && report.status==='completed'" class="qag-followups" :aria-label="ct(&quot;智能体建议的后续问题&quot;)"><small>{{ ct("顺着灵感，继续一步") }}</small><button v-for="question in report.suggestions" :key="question" type="button" :disabled="disabled" @click="emit('select',question)">{{ question }}<ClientIcon name="arrowUpRight" /></button><p>{{ ct("点击只会填入问题，由你决定是否发送。") }}</p></div>
  </section>
</template>
<script setup>
import {chatText as ct} from "../../i18n/chat.js";
import {computed} from 'vue';
import {agentRunReport,agentRunTitle} from '../../lib/agent-presentation.js';
import ClientIcon from '../reference/ClientIcon.vue';
import './agent-space.css';
import './agent-chat.css';
const props=defineProps({value:Object,disabled:Boolean}),emit=defineEmits(['select']);
const report=computed(()=>agentRunReport(props.value));
</script>
