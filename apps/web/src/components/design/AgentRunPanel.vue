<template>
  <section v-if="report" class="qag-run qag-run-board" :data-state="report.status" :aria-label="ct(&quot;智能体协作进度&quot;)">
    <header><span class="qag-mini-core" :class="{'is-working':['waiting','running'].includes(report.status)}" aria-hidden="true">Q</span><div><strong>{{ ct(agentRunTitle(report)) }}</strong><small>{{ report.context==='continued' ? ct("沿着当前分支接着聊") : ct("本轮使用独立的服务方会话") }}</small></div><ClientIcon :name="report.status==='completed'?'check':'spark'" /></header>
    <dl class="qag-run-overview" :aria-label="ct('本轮已收到的协作记录')"><div><dt><ClientIcon name="settings" />{{ ct('工具记录') }}</dt><dd>{{ overview.tools }}</dd></div><div><dt><ClientIcon name="mindmap" />{{ ct('工作流记录') }}</dt><dd>{{ overview.workflows }}</dd></div><div><dt><ClientIcon name="gallery" />{{ ct('独立成果') }}</dt><dd>{{ report.artifacts.length }}</dd></div></dl>
    <section class="qag-process">
      <button class="qag-process-toggle" type="button" :aria-expanded="processExpanded" @click="processExpanded=!processExpanded"><span><strong>{{ ct('协作过程') }}</strong><small>{{ ct('{returned} 项已返回 · {pending} 项待确认',{returned:overview.returned,pending:overview.pending}) }}</small></span><ClientIcon name="chevronRight" /></button>
      <div v-show="processExpanded" class="qag-process-body">
        <ol v-if="report.steps.length"><li v-for="(step,index) in report.steps" :key="index" :class="{'is-returned':step.state==='returned','is-awaiting':step.state!=='returned'&&working}"><span class="qag-step-symbol" aria-hidden="true"><ClientIcon :name="step.kind==='workflow'?'mindmap':'settings'" /></span><div><small>{{ ct(step.kind==='workflow'?'工作流':'工具') }} <span>· {{ String(index+1).padStart(2,'0') }}</span></small><strong class="qag-step-label">{{ agentStepLabel(step,ct) }}</strong></div><span class="qag-step-receipt"><ClientIcon :name="step.state==='returned'?'check':working?'refresh':'info'" />{{ step.state==='returned'?ct('已收到返回'):working?ct('等待返回'):ct('返回未确认') }}</span></li></ol>
        <div v-else class="qag-process-empty"><BrandLoader v-if="working" :size="26" :text="ct('正在等待可展示的过程记录…')" /><p v-else>{{ ct('本轮未提供工具或工作流记录。') }}</p></div>
        <p class="qag-process-note">{{ ct('这里只展示本轮已收到的记录；没有返回的步骤不代表执行失败。') }}</p>
        <p v-if="report.stepsTruncated" class="qag-process-note qag-process-truncated">{{ ct('过程记录已达到展示上限，部分后续记录未收录。') }}</p>
      </div>
    </section>
    <p v-if="report.cancellation" class="qag-cancel-note">{{ report.cancellation==='accepted' ? ct("服务方已接受取消请求。服务方的计算或用量可能仍会继续；本轮结果与费用以当前回执为准。") : report.cancellation==='unknown' ? ct("已停止本站接收，服务方取消结果暂未确认；不会自动重新发起对话。") : ct("正在向服务方提交取消请求…") }}</p>
    <div v-if="report.artifacts.length" class="qag-artifacts qag-result-space" :aria-label="ct(&quot;智能体返回的附件&quot;)"><header><span>{{ ct('本轮成果') }}</span><small>{{ ct('{count} 项可打开的成果',{count:report.artifacts.length}) }}</small></header><div class="qag-result-grid"><AgentArtifactCard v-for="artifact in report.artifacts" :key="artifact.url" :artifact="artifact" :message-id="messageId" :receipt="receipts[artifact.key]" :checking="checking" :checking-error="checkingError" :disabled="disabled||working" :downloading="files.busyId.value===receipts[artifact.key]?.file?.id" @save="save" @refresh="refresh" @download="files.download" @reuse="id=>emit('reuse',id)" @library="tab=>emit('library',tab)"/></div><small>{{ ct("由搭档服务提供，点击后打开；链接可能有有效期。") }}</small><p v-if="files.error.value" role="alert">{{ ct(files.error.value) }}</p></div>
    <p v-else-if="report.status==='completed'" class="qag-no-artifacts">{{ ct('本轮未提供可展示的独立成果链接。') }}</p>
    <div v-if="report.suggestions.length && report.status==='completed'" class="qag-followups" :aria-label="ct(&quot;智能体建议的后续问题&quot;)"><header><span class="qag-next-spark" aria-hidden="true">✦</span><strong>{{ ct("顺着灵感，继续一步") }}</strong></header><div><button v-for="(question,index) in report.suggestions" :key="question" type="button" :disabled="disabled" @click="emit('select',question)"><small>{{ String(index+1).padStart(2,'0') }}</small><span>{{ question }}</span><ClientIcon name="arrowUpRight" /></button></div><p>{{ ct("点击只会填入问题，由你决定是否发送。") }}</p></div>
  </section>
</template>
<script setup>
import {chatText as ct} from "../../i18n/chat.js";
import {computed,ref} from 'vue';
import {agentRunReport,agentRunTitle,agentStepLabel} from '../../lib/agent-presentation.js';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import AgentArtifactCard from './AgentArtifactCard.vue';
import {useArtifactSaves} from '../../composables/useArtifactSaves.js';
import {usePersonalFiles} from '../../composables/usePersonalFiles.js';
import './agent-space.css';
import './agent-chat.css';
import './agent-run.css';
const props=defineProps({value:Object,messageId:String,disabled:Boolean}),emit=defineEmits(['select','reuse','library']);
const report=computed(()=>agentRunReport(props.value));
const processExpanded=ref(true),working=computed(()=>['waiting','running'].includes(report.value?.status));
const {receipts,checking,checkingError,save,refresh}=useArtifactSaves(computed(()=>props.messageId),computed(()=>!!report.value?.artifacts.some(item=>item.key)&&!working.value)),files=usePersonalFiles();
const overview=computed(()=>{const steps=report.value?.steps||[],returned=steps.filter(step=>step.state==='returned').length;return{tools:steps.filter(step=>step.kind==='tool').length,workflows:steps.filter(step=>step.kind==='workflow').length,returned,pending:steps.length-returned};});
</script>
