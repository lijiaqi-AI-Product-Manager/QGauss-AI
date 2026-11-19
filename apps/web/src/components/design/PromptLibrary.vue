<template>
  <dialog ref="dialog" class="qpl-dialog" :aria-label="tt('title')" @cancel.prevent="$emit('close')" @close="onDialogClose">
    <header class="qpl-heading">
      <span class="qpl-mark" aria-hidden="true"><ClientIcon name="star" /></span>
      <div>
        <h2>{{ tt('title') }}</h2>
        <p>{{ tt('intro') }}</p>
      </div>
      <button class="qpl-icon-button" type="button" :aria-label="tt('close')" @click="$emit('close')">
        <ClientIcon name="close" />
      </button>
    </header>

    <div v-if="state === 'loading'" class="qpl-state" role="status">
      <BrandLoader :size="38" />
      <p>{{ tt('loading') }}</p>
    </div>
    <div v-else-if="state === 'error'" class="qpl-state" role="status">
      <p>{{ tt('error') }}</p>
      <button type="button" class="qpl-primary" @click="load">{{ tt('retry') }}</button>
    </div>
    <div v-else-if="!groups.length" class="qpl-state" role="status">
      <ClientIcon name="folder" />
      <p>{{ tt('empty') }}</p>
    </div>
    <div v-else class="qpl-body">
      <div class="qpl-catalog">
        <label class="qpl-search">
          <ClientIcon name="search" />
          <input v-model="query" type="search" :aria-label="tt('search')" :placeholder="tt('search')" />
        </label>
        <div class="qpl-groups" :aria-label="tt('groups')" role="group">
          <button type="button" :aria-pressed="groupId === null" @click="groupId = null">{{ tt('all') }}</button>
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            :aria-pressed="group.id === groupId"
            @click="groupId = group.id"
          >{{ groupName(group) }}</button>
        </div>
        <p v-if="!results.length" class="qpl-no-match" role="status">{{ tt('noMatch') }}</p>
        <div v-else class="qpl-results">
          <button
            v-for="item in results"
            :key="item.id"
            type="button"
            :aria-pressed="item.id === selectedId"
            @click="selectedId = item.id"
          >
            <span class="qpl-item-name">{{ item.title }}</span>
            <small>{{ item.group }}</small>
          </button>
        </div>
      </div>
      <section class="qpl-preview" :aria-label="tt('preview')">
        <template v-if="selected">
          <h3>{{ selected.title }}</h3>
          <p class="qpl-prompt">{{ selected.prompt }}</p>
          <p v-if="hasDraft" class="qpl-note">{{ tt('preserved') }}</p>
          <button type="button" class="qpl-primary" :disabled="disabled" @click="$emit('apply', selected.prompt)">
            {{ tt('apply') }} <ClientIcon name="arrow" />
          </button>
        </template>
        <p v-else class="qpl-no-match">{{ tt('pick') }}</p>
      </section>
    </div>
  </dialog>
</template>

<script setup>
import {computed, nextTick, onUnmounted, ref, watch} from 'vue';
import {api} from '../../api/client.js';
import {currentLang} from '../../i18n/index.js';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import './prompt-library.css';

const props = defineProps({
  open: Boolean,
  hasDraft: Boolean,
  disabled: Boolean,
});
const emit = defineEmits(['close', 'apply']);

const labels = {
  title: ['提示词库', '提示詞庫', 'Prompt library'],
  intro: ['选一个起点，读完内容再加入对话。', '選一個起點，讀完內容再加入對話。', 'Preview a starting point for your conversation.'],
  close: ['关闭提示词库', '關閉提示詞庫', 'Close prompt library'],
  loading: ['正在读取提示词…', '正在讀取提示詞…', 'Loading prompts…'],
  error: ['提示词暂时未能加载。', '提示詞暫時未能載入。', 'Prompts are temporarily unavailable.'],
  retry: ['重新读取', '重新讀取', 'Try again'],
  empty: ['还没有可用的提示词。', '目前沒有可用的提示詞。', 'No prompts are available yet.'],
  search: ['搜索名称或内容', '搜尋名稱或內容', 'Search titles or prompts'],
  groups: ['提示词分组', '提示詞分組', 'Prompt groups'],
  all: ['全部分组', '所有分組', 'All groups'],
  ungrouped: ['未分组', '未分組', 'Ungrouped'],
  noMatch: ['没有找到匹配的提示词。', '找不到相符的提示詞。', 'No matching prompts.'],
  preview: ['提示词预览', '提示詞預覽', 'Prompt preview'],
  pick: ['选择一条提示词查看完整内容。', '選擇一條提示詞查看完整內容。', 'Select a prompt to read it in full.'],
  preserved: ['提示词会加入草稿开头，原有内容保留。', '提示詞會加入草稿開頭，原有內容會保留。', 'The prompt goes above your existing draft.'],
  apply: ['加入草稿', '加入草稿', 'Add to draft'],
};
const tt = key => labels[key][currentLang.value === 'en' ? 2 : currentLang.value === 'zh-TW' ? 1 : 0];
const dialog = ref(null);
const groups = ref([]);
const query = ref('');
const groupId = ref(null);
const selectedId = ref(null);
const state = ref('loading');
let request;

const groupName = group => group.id === 'ungrouped' ? tt('ungrouped') : group.name;
const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
const results = computed(() => {
  const search = normalize(query.value.trim());
  return groups.value
    .filter(group => groupId.value === null || group.id === groupId.value)
    .flatMap(group => group.items.map(item => ({...item, group: groupName(group)})))
    .filter(item => !search || normalize([item.title, item.group, item.prompt].join('\n')).includes(search));
});
const selected = computed(() => results.value.find(item => item.id === selectedId.value));
watch(results, rows => {
  if (!rows.some(row => row.id === selectedId.value)) selectedId.value = null;
});

function catalog(value) {
  if (!Array.isArray(value)) throw new Error('Invalid prompt catalog');
  const ids = new Set();
  return value.map(group => {
    if (typeof group?.id !== 'string' || typeof group.name !== 'string' || !Array.isArray(group.items)) {
      throw new Error('Invalid prompt group');
    }
    for (const item of group.items) {
      if (typeof item?.id !== 'string' || typeof item.title !== 'string' || typeof item.prompt !== 'string' || ids.has(item.id)) {
        throw new Error('Invalid prompt entry');
      }
      ids.add(item.id);
    }
    return group;
  }).filter(group => group.items.length);
}

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  groups.value = [];
  try {
    const response = await api.get('/presets', {signal: controller.signal, retry: false});
    if (request === controller && props.open) {
      groups.value = catalog(response);
      state.value = 'ready';
    }
  } catch {
    if (request === controller && props.open) state.value = 'error';
  } finally {
    if (request === controller) request = null;
  }
}

function onDialogClose() {
  if (props.open && !dialog.value?.open) emit('close');
}

watch(() => props.open, async open => {
  if (!open) {
    request?.abort();
    request = null;
    groups.value = [];
    query.value = '';
    groupId.value = null;
    selectedId.value = null;
    dialog.value?.close();
    return;
  }
  void load();
  await nextTick();
  if (props.open && dialog.value && !dialog.value.open) dialog.value.showModal();
});
onUnmounted(() => {
  request?.abort();
  request = null;
});
</script>
