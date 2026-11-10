<template>
  <section class="qcr-page" :aria-label="ct('对话记录')">
    <header class="qcr-hero">
      <div class="qcr-hero-copy"><span class="qcr-eyebrow">QGauss AI · RECORDS</span><h1>{{ ct('每一次回应，都有迹可循') }}</h1><p>{{ ct('查找消息、查看分支与费用凭据，把一次对话的来龙去脉看清楚。') }}</p></div>
      <div class="qcr-orbit" aria-hidden="true"><i></i><span><ClientIcon name="chat" /></span><b></b></div>
    </header>
    <div class="qcr-metrics">
      <article><span class="qcr-metric-icon"><ClientIcon name="search" /></span><div><small>{{ ct('匹配记录') }}</small><strong>{{ applied ? total.toLocaleString() : '—' }}</strong></div><i></i></article>
      <article><span class="qcr-metric-icon qcr-mint"><ClientIcon name="check" /></span><div><small>{{ ct('本页已完成') }}</small><strong>{{ applied ? completed : '—' }}</strong></div><i></i></article>
      <article><span class="qcr-metric-icon qcr-peach"><ClientIcon name="refresh" /></span><div><small>{{ ct('本页处理中') }}</small><strong>{{ applied ? processing : '—' }}</strong></div><i></i></article>
    </div>
    <form class="qcr-filters" @submit.prevent="search">
      <div class="qcr-section-title"><h2><ClientIcon name="search" />{{ ct('查找记录') }}</h2><span v-if="dirty" class="qcr-dirty" role="status">{{ ct('已更新筛选条件，点击查询后生效。') }}</span></div>
      <div class="qcr-primary-filters">
        <label>{{ ct('内容关键词') }}<input v-model="filters.keyword" name="keyword" maxlength="400" :placeholder="ct('内容关键词')" /></label>
        <label>{{ ct('用户') }}<input v-model="filters.user" name="user" maxlength="160" :placeholder="ct('用户名、邮箱或用户编号')" /></label>
        <label>{{ ct('模型名称') }}<input v-model="filters.modelName" name="modelName" maxlength="200" :placeholder="ct('模型名称')" /></label>
        <div class="qcr-search-actions"><button type="submit" class="qcr-button qcr-primary"><ClientIcon name="search" />{{ ct('查询') }}</button><button type="button" class="qcr-button" @click="reset">{{ ct('重置') }}</button></div>
      </div>
      <details class="qcr-more-filters"><summary>{{ ct('更多筛选') }}<span>⌄</span></summary><div class="qcr-extra-grid">
        <label>{{ ct('处理状态') }}<select v-model="filters.status" name="status"><option value="">{{ ct('全部状态') }}</option><option v-for="value in statuses" :key="value" :value="value">{{ ct(recordStatus(value)) }}</option></select></label>
        <label>{{ ct('消息角色') }}<select v-model="filters.role" name="role"><option value="">{{ ct('全部角色') }}</option><option v-for="value in ['USER','ASSISTANT','SYSTEM']" :key="value" :value="value">{{ ct(recordRole(value)) }}</option></select></label>
        <label>{{ ct('费用状态') }}<select v-model="filters.billingState" name="billingState"><option value="">{{ ct('全部费用') }}</option><option v-for="value in ['LEGACY','FREE','RESERVED','SETTLING','SETTLED','RELEASED']" :key="value" :value="value">{{ ct(billingStatus(value)) }}</option></select></label>
        <label>{{ ct('对话类型') }}<select v-model="filters.kind" name="kind"><option value="all">{{ ct('全部类型') }}</option><option value="chat">{{ ct('普通对话') }}</option><option value="app">{{ ct('应用对话') }}</option><option value="agent">{{ ct('协作对话') }}</option></select></label>
        <label>{{ ct('会话范围') }}<select v-model="filters.scope" name="scope"><option value="all">{{ ct('全部会话') }}</option><option value="active">{{ ct('使用中') }}</option><option value="trash">{{ ct('回收站') }}</option></select></label>
        <label>{{ ct('会话编号') }}<input v-model="filters.conversationId" name="conversationId" maxlength="128" :placeholder="ct('会话编号')" /></label>
        <label>{{ ct('开始日期') }}<input v-model="filters.from" name="from" type="date" /></label>
        <label>{{ ct('结束日期') }}<input v-model="filters.to" name="to" type="date" /></label>
      </div></details>
    </form>
    <section class="qcr-results" :aria-busy="loading">
      <div class="qcr-results-toolbar"><div><h2>{{ ct('对话记录') }}<span>{{ applied ? total.toLocaleString() : '—' }}</span></h2><small v-if="applied">{{ ct('读取时间') }} {{ format(applied.asOf) }}</small></div><button type="button" class="qcr-button qcr-export" :disabled="!canExport" @click="exportExcel"><ClientIcon name="download" />{{ ct(exporting ? '准备文件中' : '导出当前查询') }}</button><button v-if="exporting" type="button" class="qcr-button" @click="cancelExport">{{ ct('取消下载') }}</button></div>
      <p class="qcr-export-copy">{{ ct('按已查询条件导出，状态以导出时为准；单次最多 20000 条，长文本完整分段保留。') }} <b v-if="total > 20000">{{ ct('请缩小筛选范围后导出。') }}</b></p>
      <div v-if="error" class="qcr-feedback qcr-error" role="alert"><span>{{ ct(error) }}</span><button type="button" class="qcr-button" @click="retry">{{ ct('重试') }}</button></div>
      <p v-if="exportError" class="qcr-feedback qcr-error" role="alert">{{ ct(exportError) }}</p><p v-if="exportNotice" class="qcr-feedback" role="status">{{ ct(exportNotice) }}</p>
      <div v-if="loading" class="qcr-loading"><BrandLoader :size="48" :text="ct('正在查找记录')" /><div class="qcr-skeleton" aria-hidden="true"><i v-for="i in 3" :key="i"></i></div></div>
      <template v-else>
        <div v-if="!rows.length && !error" class="qcr-empty"><span><ClientIcon name="chat" /></span><h3>{{ ct('没有匹配的记录') }}</h3><p>{{ ct('试试其他关键词，或放宽日期与状态条件。') }}</p></div>
        <div v-else-if="rows.length" class="qcr-record-list">
          <div class="qcr-list-heading" aria-hidden="true"><span>{{ ct('用户') }} / {{ ct('对话记录') }}</span><span>{{ ct('消息内容') }}</span><span>{{ ct('处理状态') }}</span><span>{{ ct('用量与费用') }}</span></div>
          <article v-for="row in rows" :key="row.id" class="qcr-record" :data-record-id="row.id">
            <div class="qcr-record-person"><span class="qcr-avatar">{{ (row.user || 'Q').slice(0,1).toUpperCase() }}</span><div><b>{{ row.user || '—' }}</b><small>{{ row.email || '—' }}</small><span class="qcr-conversation">{{ row.conversationTitle || '—' }}</span><span v-if="row.conversationDeletedAt" class="qcr-trash">{{ ct('回收站') }}</span></div></div>
            <div class="qcr-record-content"><div><span class="qcr-role">{{ ct(recordRole(row.role)) }}</span><small>{{ format(row.createdAt) }}</small></div><p>{{ row.content || ct('无文字内容') }}</p><button type="button" class="qcr-detail-link" @click="openDetail(row.id)">{{ ct('查看明细') }}<ClientIcon name="arrow" /></button></div>
            <div class="qcr-record-state"><span class="qcr-status" :data-status="row.status">{{ ct(recordStatus(row.status)) }}</span><small>{{ row.modelName || '—' }}</small></div>
            <div class="qcr-record-usage"><b>{{ recordUsage(row.promptTokens) }} <span>/</span> {{ recordUsage(row.completionTokens) }}</b><small>{{ ct('输入 / 输出') }} <i v-if="row.usageEstimated">{{ ct('估算用量') }}</i></small><span class="qcr-billing">{{ ct(billingStatus(row.billing?.state)) }}<b v-if="row.billing?.charged"> · {{ row.billing.charged }}</b></span></div>
          </article>
        </div>
      </template>
      <nav v-if="applied" class="qcr-pagination" :aria-label="ct('对话记录')"><span>{{ ct('第 {page} / {pages} 页', { page, pages }) }}</span><div><button type="button" class="qcr-button" :disabled="loading || page <= 1" @click="goPage(page - 1)">{{ ct('上一页') }}</button><button type="button" class="qcr-button" :disabled="loading || page >= pages" @click="goPage(page + 1)">{{ ct('下一页') }}</button></div></nav>
    </section>
    <dialog ref="dialog" class="qcr-dialog" aria-labelledby="qcr-detail-heading" @close="closeDetail" @cancel.prevent="closeDetail" @click="closeBackdrop">
      <header><div><small>QGauss AI · RECORD</small><h2 id="qcr-detail-heading">{{ ct('消息明细') }}</h2></div><button type="button" class="qcr-close" :aria-label="ct('关闭明细')" @click="closeDetail"><ClientIcon name="close" /></button></header>
      <div class="qcr-dialog-body">
        <div v-if="detailLoading" class="qcr-loading"><BrandLoader :text="ct('正在读取消息')" /></div>
        <div v-else-if="detailError" class="qcr-feedback qcr-error" role="alert"><span>{{ ct(detailError) }}</span><button type="button" class="qcr-button" @click="openDetail(selectedId)">{{ ct('重试') }}</button></div>
        <template v-else-if="detail">
          <div class="qcr-detail-title"><h3>{{ detail.conversationTitle }}</h3><span class="qcr-status" :data-status="detail.status">{{ ct(recordStatus(detail.status)) }}</span><span v-if="detail.conversationDeletedAt" class="qcr-trash">{{ ct('回收站') }}</span></div>
          <section class="qcr-message-body"><h3>{{ ct('消息内容') }} <span>{{ ct(recordRole(detail.role)) }}</span></h3><pre>{{ detail.content || ct('无文字内容') }}</pre></section>
          <section class="qcr-receipt"><h3>{{ ct('费用凭据') }}<span>{{ ct(billingStatus(detail.billing?.state)) }}</span></h3><div v-if="detail.billing" class="qcr-receipt-values"><div v-for="[label,key] in [['预留','reserved'],['实扣','charged'],['已返还','returned'],['已到期','expired']]" :key="key"><small>{{ ct(label) }}</small><b>{{ detail.billing[key] }}</b></div></div><p v-else>{{ ct('历史记录未保留费用凭据。') }}</p><small>{{ ct('处理中状态并不代表已扣次，请以费用凭据为准。') }}</small></section>
          <details class="qcr-record-information"><summary>{{ ct('记录信息') }}</summary><dl class="qcr-detail-meta"><div v-for="[label,value] in metadata" :key="label"><dt>{{ ct(label) }}</dt><dd>{{ value ?? '—' }}</dd></div></dl></details>
          <details v-if="detail.reasoning" class="qcr-reasoning"><summary>{{ ct('推理内容') }}</summary><pre>{{ detail.reasoning }}</pre></details>
          <section v-if="detail.parent" class="qcr-parent"><h3>{{ ct('上条消息') }}</h3><p>{{ detail.parent.content }}</p><button type="button" class="qcr-detail-link" @click="openDetail(detail.parent.id)">{{ ct('查看上条消息') }}<ClientIcon name="arrow" /></button></section>
          <section v-if="detail.branches.length" class="qcr-branches"><h3>{{ ct('回复分支') }} <span>{{ detail.branchCount }}</span></h3><button v-for="(branch,index) in detail.branches" :key="branch.id" type="button" :class="{ 'is-current': branch.id === detail.id }" :disabled="branch.id === detail.id" @click="openDetail(branch.id)"><b>{{ String(index + 1).padStart(2,'0') }}</b><span><strong>{{ branch.modelName || '—' }}</strong><small>{{ branch.content || ct('无文字内容') }}</small></span><i>{{ ct(branch.id === detail.id ? '当前消息' : recordStatus(branch.status)) }}</i></button><p v-if="detail.branchCount > 100">{{ ct('共 {count} 个分支，显示前 100 个。',{count:detail.branchCount}) }}</p></section>
        </template>
      </div>
    </dialog>
  </section>
</template>
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import ClientIcon from '../../components/reference/ClientIcon.vue';
import BrandLoader from '../../components/design/BrandLoader.vue';
import { currentLang } from '../../i18n/index.js';
import { recordText } from '../../i18n/record-messages.js';
import { recordStatus, recordRole, billingStatus, recordUsage } from '../../lib/conversation-records.js';
import { useConversationRecords } from '../../composables/useConversationRecords.js';
import '../../components/design/conversation-records.css';
const { filters, rows, total, page, pageSize, loading, error, applied, dirty, exporting, exportError, exportNotice, canExport, selectedId, detail, detailLoading, detailError, search, reset, retry, goPage, openDetail, closeDetail, exportExcel, cancelExport } = useConversationRecords();
const ct = (text, values) => recordText(currentLang.value, text, values), dialog = ref(null);
const statuses = ['PENDING','STREAMING','SETTLING','COMPLETED','FAILED','ABORTED'];
const completed = computed(() => rows.value.filter(row => row.status === 'COMPLETED').length), processing = computed(() => rows.value.filter(row => ['PENDING','STREAMING','SETTLING'].includes(row.status)).length), pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const format = value => value ? new Date(value).toLocaleString(currentLang.value === 'en' ? 'en-US' : currentLang.value === 'zh-TW' ? 'zh-TW' : 'zh-CN', { hour12: false }) : '—';
const metadata = computed(() => detail.value ? [['用户', `${detail.value.user || '—'} · ${detail.value.email || '—'}`],['模型名称',detail.value.modelName],['创建时间',format(detail.value.createdAt)],['更新时间',format(detail.value.updatedAt)],['记录编号',detail.value.id],['会话编号',detail.value.conversationId],['输入 / 输出',`${recordUsage(detail.value.promptTokens)} / ${recordUsage(detail.value.completionTokens)}${detail.value.usageEstimated ? ' · '+ct('估算用量') : ''}`],['结束原因',detail.value.finishReason],['错误代码',detail.value.errorCode]] : []);
watch(selectedId, async value => { await nextTick(); if (value && selectedId.value && !dialog.value?.open) dialog.value?.showModal(); else if (!selectedId.value && dialog.value?.open) dialog.value.close(); });
function closeBackdrop(event) { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDetail(); } }
onMounted(search);
</script>
