<template>
  <dialog ref="dialog" class="qgc-model-dialog" aria-labelledby="qgc-model-picker-title" :aria-busy="busy" @cancel.prevent="emit('close')" @click="onBackdrop" @close="onClosed">
    <div class="qgc-picker-content">
      <div class="qgc-picker-mobile-close"><button type="button" aria-label="关闭模型广场" @click="emit('close')"><ClientIcon name="close" /></button></div>
      <header class="qgc-picker-header">
        <h1 id="qgc-model-picker-title">模型广场</h1>
        <div class="qgc-picker-search">
          <input ref="searchInput" :value="keyword" placeholder="搜索模型名称..." aria-label="搜索模型" :autofocus="autoFocusSearch" @input="keyword = $event.target.value" />
          <button v-if="keyword" type="button" class="qgc-picker-clear" aria-label="清空搜索" @click="keyword = ''"><ClientIcon name="close" /></button>
          <button type="button" class="qgc-picker-search-button" aria-label="搜索模型" @click="searchInput?.focus()"><ClientIcon name="search" /></button>
        </div>
      </header>
      <section class="qgc-picker-summary" aria-label="供应商信息">
        <div><div class="qgc-picker-summary-title"><strong>全部供应商</strong><span>共 {{ models.length }} 个模型</span></div><p>查看所有可用的AI模型供应商，包括众多知名供应商的模型。</p></div>
      </section>
      <div class="qgc-picker-tabs">
        <nav class="qgc-picker-vendors" aria-label="模型供应商">
          <button type="button" class="qgc-picker-arrow" aria-label="向左滚动供应商" @click="scrollVendors(-1)"><ClientIcon name="chevronLeft" /></button>
          <div ref="vendorStrip" class="qgc-picker-vendor-strip" role="tablist" aria-label="供应商筛选">
            <button v-for="item in vendors" :key="item.key" type="button" role="tab" :aria-selected="vendor === item.key" :tabindex="vendor === item.key ? 0 : -1" class="qgc-picker-vendor" :class="{ active: vendor === item.key }" @click="vendor = item.key" @keydown="onVendorKeydown($event, item.key)"><span><img v-if="item.key === 'QGauss'" src="/brand/qgauss-mark.svg" alt="" /><ClientIcon v-else-if="item.key" class="qgc-picker-vendor-icon" name="model" /><span>{{ item.label }}</span><small>{{ item.count }}</small></span></button>
          </div>
          <button type="button" class="qgc-picker-arrow" aria-label="向右滚动供应商" @click="scrollVendors(1)"><ClientIcon name="chevronRight" /></button>
        </nav>
        <div class="qgc-picker-pane">
          <div class="qgc-picker-grid" role="tabpanel" aria-label="模型列表">
            <article v-for="item in visibleModels" :key="item.id" class="cv-model-item qgc-picker-card" :class="{ active: item.name === selected, offline: !item.ready }" :data-model-id="item.id">
              <span v-if="item.badge" class="qgc-picker-badge">{{ item.badge }}</span>
              <img class="qgc-picker-image" src="/brand/qgauss-mark.svg" alt="" />
              <div class="qgc-picker-name" :title="item.description || item.displayName">{{ item.displayName || item.name }}</div>
              <div class="qgc-picker-meta"><span class="qgc-picker-price"><i></i>{{ !item.ready ? '暂未接入' : modelBilling(item).title }}</span></div>
              <div class="qgc-picker-capabilities" aria-label="模型能力"><span v-for="capability in modelCapabilities(item)" :key="capability.key" :title="capability.label" :aria-label="capability.label"><ClientIcon :name="capability.icon" /></span></div>
              <div class="qgc-picker-actions"><button type="button" class="qgc-picker-use" :disabled="busy || !item.ready" @click="emit('select', item)"><ClientIcon :name="item.name === selected ? 'check' : 'chat'" />{{ busy ? '正在保存' : item.name === selected ? '当前使用' : item.ready ? '立即使用' : '暂未接入' }}</button></div>
            </article>
            <p v-if="visibleModels.length === 0" class="qgc-picker-empty">没有匹配的模型</p>
          </div>
        </div>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import ClientIcon from './ClientIcon.vue';
import { imageOnly, modelBilling } from '../../lib/model-presentation.js';
import './model-picker.css';

const props = defineProps({ open: Boolean, models: { type: Array, default: () => [] }, selected: String, busy: Boolean });
const emit = defineEmits(['close', 'select']);
const dialog = ref(null), vendorStrip = ref(null), searchInput = ref(null), keyword = ref(''), vendor = ref(''), autoFocusSearch = ref(false);
const chatModels = computed(() => props.models.filter(model => !imageOnly(model)));
const vendors = computed(() => {
  const groups = new Map();
  for (const model of chatModels.value) { const key = model.vendor || '其他'; groups.set(key, (groups.get(key) || 0) + 1); }
  return [{ key: '', label: '全部供应商', count: chatModels.value.length }, ...[...groups].map(([key, count]) => ({ key, label: key, count }))];
});
const vendorModels = computed(() => chatModels.value.filter(model => !vendor.value || (model.vendor || '其他') === vendor.value));
const visibleModels = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase();
  return vendorModels.value.filter(model => !query || [model.displayName, model.name, model.vendor, model.description, ...(model.tags || []), ...(model.capabilities || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
});
watch(keyword, value => { if (value.trim()) vendor.value = ''; });
watch(() => props.open, async open => {
  await nextTick();
  if (!dialog.value || open !== props.open) return;
  if (open && !dialog.value.open) {
    keyword.value = '';
    autoFocusSearch.value = !window.matchMedia('(max-width:639px)').matches;
    const current = props.models.find(model => model.name === props.selected);
    vendor.value = current?.vendor || '';
    await nextTick();
    if (!props.open) return;
    dialog.value.showModal();
    await nextTick();
    vendorStrip.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  } else if (!open && dialog.value.open) dialog.value.close();
});
function onClosed() { if (props.open) emit('close'); }
function onBackdrop(event) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close');
}
function scrollVendors(direction) { vendorStrip.value?.scrollBy({ left: direction * Math.max(120, vendorStrip.value.clientWidth * .7), behavior: 'smooth' }); }
function onVendorKeydown(event, key) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = vendors.value.findIndex(item => item.key === key);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? vendors.value.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + vendors.value.length) % vendors.value.length;
  vendor.value = vendors.value[next].key;
  nextTick(() => vendorStrip.value?.querySelector('[aria-selected="true"]')?.focus());
}
function modelCapabilities(model) {
  const supported = new Set(model.capabilities || []);
  return [{ key: 'chat', label: '文本对话', icon: 'chat' }, ...(supported.has('vision') ? [{ key: 'vision', label: '图片理解', icon: 'image' }] : []), ...(supported.has('reasoning') ? [{ key: 'reasoning', label: '深度思考', icon: 'reasoning' }] : []), ...(supported.has('web_search') ? [{ key:'web_search',label:'联网检索',icon:'globe' }] : []), ...(supported.has('tools') ? [{ key: 'tools', label: '工具调用', icon: 'settings' }] : [])];
}
</script>
