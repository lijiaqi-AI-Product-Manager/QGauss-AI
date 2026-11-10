<template>
  <section v-if="state.panel!=='closed'" class="qgua-card" aria-labelledby="qgua-heading" :aria-busy="state.busy">
    <header class="qgua-heading"><div class="qgua-symbol" aria-hidden="true"><ClientIcon :name="state.panel==='sessions'?'lock':'user'" /><i></i></div><div><small>QGauss · ACCOUNT CARE</small><h3 id="qgua-heading">{{ ct(state.panel==='sessions'?'登录管理':state.panel==='edit'?'维护资料':state.panel==='done'?'操作已完成':'核对账户操作') }}</h3></div><button type="button" class="qgu-close" :disabled="state.busy" :aria-label="ct('收起此面板')" @click="state.closePanel"><ClientIcon name="close" /></button></header>

    <form v-if="state.panel==='edit'" class="qgua-edit" @submit.prevent="state.reviewMetadata">
      <div class="qgua-recipient"><b>{{ person.username }}</b><small>{{ person.email }}</small></div>
      <label>{{ ct('管理备注') }}<textarea v-model="state.draft.adminNote" name="adminNote" maxlength="2000" rows="4" :placeholder="ct('记录服务背景或跟进事项，仅管理员可见。')"></textarea><small>{{ state.draft.adminNote.length }} / 2000 · {{ ct('仅管理员可见') }}</small></label>
      <label class="qgua-toggle"><input v-model="state.draft.isDistribution" name="isDistribution" type="checkbox" /><span><b>{{ ct('分销资格') }}</b><small>{{ ct('控制当前分销资格；推广账户另有启停设置，已有邀请与账目保留。') }}</small></span><i aria-hidden="true"></i></label>
      <p v-if="state.draft.isDistribution && person.distributionAccountReady===false" class="qgua-hint">{{ ct('确认后将按站点默认比例准备推广账户，已有账户设置不变。') }}</p>
      <footer class="qgua-actions"><button type="button" class="qgu-button" @click="state.closePanel">{{ ct('取消') }}</button><button type="submit" class="qgu-button qgu-primary" data-review-management>{{ ct('下一步：核对') }}<ClientIcon name="arrow" /></button></footer>
    </form>

    <div v-else-if="state.panel==='sessions'" class="qgua-sessions">
      <div class="qgua-session-summary"><div><b>{{ state.sessions?ct('{count} 次有效登录',{count:state.sessions.activeTotal}):'—' }}</b><p>{{ ct('有效登录尚未到期且未被结束；账号停用时仍无法访问。') }}</p></div><button type="button" class="qgu-button" :disabled="state.sessionLoading || state.busy" @click="state.loadSessions(1,{fresh:true})"><ClientIcon name="refresh" />{{ ct('刷新') }}</button></div>
      <p v-if="state.sessionError" class="qgu-feedback qgu-error" role="alert">{{ ct(state.sessionError) }}<button type="button" class="qgu-button" @click="state.retrySessions">{{ ct('重试') }}</button></p>
      <div v-if="state.sessionLoading" class="qgu-loading"><BrandLoader :size="40" :text="ct('正在读取有效登录')" /></div>
      <p v-else-if="!state.sessions?.items.length && !state.sessionError" class="qgua-empty">{{ ct('没有可继续使用的登录') }}</p>
      <div v-else class="qgua-device-grid">
        <article v-for="row in state.sessions?.items" :key="row.id" class="qgua-device">
          <div class="qgua-device-top"><span class="qgua-device-icon"><ClientIcon name="layout" /></span><div><b>{{ deviceLabel(row.userAgent) || ct('浏览器登录') }}</b><small>{{ row.ip || ct('网络地址未知') }}</small></div><span v-if="row.isCurrent" class="qgua-current">{{ ct(state.self?'当前登录':'当前管理登录') }}</span></div>
          <dl><div><dt>{{ ct('首次登录') }}</dt><dd>{{ format(row.createdAt) }}</dd></div><div><dt>{{ ct('最近使用') }}</dt><dd>{{ format(row.lastSeenAt) }}</dd></div><div><dt>{{ ct('登录有效期') }}</dt><dd>{{ format(row.expiresAt) }}</dd></div></dl>
          <details v-if="row.userAgent"><summary>{{ ct('设备信息') }}</summary><p>{{ row.userAgent }}</p></details>
          <button type="button" class="qgu-button" :disabled="row.isCurrent || state.busy || state.sessionLoading || !!state.sessionError" :title="row.isCurrent?ct('当前登录请使用退出登录'):undefined" @click="state.reviewSession(row)">{{ ct('结束这次登录') }}</button>
        </article>
      </div>
      <nav v-if="state.sessions?.total" class="qgu-pagination" :aria-label="ct('登录管理')"><span>{{ ct('第 {page} / {pages} 页',{page:state.sessionPage,pages:state.sessionPages}) }}</span><div><button type="button" class="qgu-button" :disabled="state.sessionLoading || state.sessionPage<=1" @click="state.loadSessions(state.sessionPage-1)">{{ ct('上一页') }}</button><button type="button" class="qgu-button" :disabled="state.sessionLoading || state.sessionPage>=state.sessionPages" @click="state.loadSessions(state.sessionPage+1)">{{ ct('下一页') }}</button></div></nav>
      <div v-if="state.self" class="qgua-all"><p>{{ ct('结束其他登录会保留当前正在使用的登录。') }}</p><button type="button" class="qgu-button qgua-danger" :disabled="!state.sessions?.otherTotal || state.sessionLoading || state.busy" @click="state.reviewOthers">{{ ct('核对其他登录下线') }}</button></div>
      <div v-else class="qgua-all"><p>{{ ct(person.id===state.ownId?'当前管理账号不能全部下线，请使用其他管理登录操作。':'全部下线会结束该账号当前的所有有效登录，账号启停状态保持不变。') }}</p><button type="button" class="qgu-button qgua-danger" :disabled="person.id===state.ownId || !state.sessions?.activeTotal || state.sessionLoading || state.busy" @click="state.reviewAll">{{ ct('核对全部下线') }}</button></div>
    </div>

    <div v-else-if="state.panel==='review' && state.review" class="qgua-review">
      <div class="qgua-recipient"><span>{{ ct('本次操作的账号') }}</span><b>{{ state.review.target.username }}</b><small>{{ state.review.target.email }}</small><small>{{ state.review.target.id }}</small></div>
      <template v-if="state.review.kind==='metadata'">
        <div v-if="Object.hasOwn(state.review.payload,'adminNote')" class="qgua-compare"><h4>{{ ct('管理备注') }}</h4><div><article><small>{{ ct('修改前') }}</small><p>{{ state.review.before.adminNote || ct('无备注') }}</p></article><ClientIcon name="arrow" /><article><small>{{ ct('修改后') }}</small><p>{{ state.review.payload.adminNote || ct('无备注') }}</p></article></div></div>
        <div v-if="Object.hasOwn(state.review.payload,'isDistribution')" class="qgua-compare"><h4>{{ ct('分销资格') }}</h4><div><article>{{ ct(state.review.before.isDistribution?'已开通':'未开通') }}</article><ClientIcon name="arrow" /><article>{{ ct(state.review.payload.isDistribution?'已开通':'未开通') }}</article></div><p v-if="state.review.payload.isDistribution" class="qgua-hint">{{ ct('确认后将按站点默认比例准备推广账户，已有账户设置不变。') }}</p></div>
      </template>
      <template v-else-if="state.review.kind==='session'"><div class="qgua-impact"><ClientIcon name="lock" /><div><b>{{ state.review.device.label || ct('浏览器登录') }}</b><small>{{ state.review.device.ip || ct('网络地址未知') }}</small><p>{{ ct('这次登录中的所有页面都需要重新登录，其他登录保持可用。') }}</p></div></div></template>
      <div v-else class="qgua-impact"><ClientIcon name="lock" /><div><b>{{ ct(state.review.kind==='others'?'已核对 {count} 次其他登录':'已核对 {count} 次有效登录',{count:state.review.count}) }}</b><p>{{ ct(state.review.kind==='others'?'确认后结束这些登录，当前登录保持可用。':'确认后将全部下线。若资料或登录范围变化，会要求重新核对。') }}</p></div></div>
      <p v-if="state.pending?.state==='uncertain'" class="qgua-hint">{{ ct('结果待确认，将继续核对保留的原操作。') }}</p>
      <div v-if="state.pending?.state==='uncertain'" class="qgua-conclude"><p class="qgua-hint">{{ ct('也可保留已生效的结果，并结束尚未生效的原操作。') }}</p><button type="button" class="qgu-button" :disabled="state.busy" @click="state.finish">{{ ct('核对结果并收尾') }}</button></div>
      <footer class="qgua-actions"><button v-if="!state.pending" type="button" class="qgu-button" :disabled="state.busy" @click="state.revise">{{ ct('返回调整') }}</button><button v-if="state.pending?.state==='rejected'" type="button" class="qgu-button" :disabled="state.busy" @click="state.revise">{{ ct('重新读取并保留修改') }}</button><button type="button" class="qgu-button qgu-primary" :disabled="state.busy || state.pending?.state==='rejected'" data-confirm-management @click="state.confirm">{{ ct(state.busy?'正在确认':state.pending?'继续核对原操作':'确认本次操作') }}</button></footer>
    </div>

    <div v-else-if="state.panel==='done' && state.receipt" class="qgua-done" tabindex="-1" role="status"><span><ClientIcon name="check" /></span><h4>{{ ct(state.receipt.outcome==='NOT_APPLIED'?'未生效操作已结束':state.receipt.kind==='metadata'?'资料已更新':'登录已结束') }}</h4><p v-if="state.receipt.kind!=='metadata' && state.receipt.outcome==='APPLIED'">{{ ct('已结束 {count} 次有效登录',{count:state.receipt.endedCount}) }}</p><p>{{ state.receiptTarget?.username }} · {{ state.receiptTarget?.email }}</p><small>{{ ct('凭据编号') }}</small><p class="qgu-receipt-id">{{ state.receipt.id }}</p></div>
    <p v-if="state.error" class="qgu-feedback qgu-error" role="alert">{{ ct(state.error) }}</p>
  </section>
</template>

<script setup>
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from '../design/BrandLoader.vue';
import {currentLang} from '../../i18n/index.js';
import {controlText} from '../../i18n/user-account-messages.js';
import {deviceLabel} from '../../lib/user-account-controls.js';
import '../design/user-account-controls.css';
defineProps({state:{type:Object,required:true},person:{type:Object,default:null}});
const ct=(value,params)=>controlText(currentLang.value,value,params);
const format=value=>new Date(value).toLocaleString(currentLang.value==='en'?'en-US':currentLang.value==='zh-TW'?'zh-TW':'zh-CN',{hour12:false});
</script>
