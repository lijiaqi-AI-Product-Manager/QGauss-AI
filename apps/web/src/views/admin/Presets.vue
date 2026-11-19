<template>
  <div class="qpa-page">
    <header class="qpa-hero">
      <div>
        <h1>{{ tt('studio') }}</h1>
        <p>{{ tt('intro') }}</p>
      </div>
      <div class="qpa-objects" aria-hidden="true"><i></i><span><ClientIcon name="star" /></span></div>
    </header>

    <div class="qpa-workspace">
      <aside class="qpa-pane" :aria-label="tt('groups')">
        <div class="qpa-pane-heading">
          <h2>{{ tt('groups') }}</h2>
          <button class="qpa-button" type="button" :disabled="loading || !!loadError" @click="editGroup()">{{ tt('newGroup') }}</button>
        </div>
        <div class="qpa-groups">
          <button type="button" :aria-pressed="groupId === null" @click="groupId = null">{{ tt('all') }}</button>
          <button type="button" :aria-pressed="groupId === ''" @click="groupId = ''">{{ tt('ungrouped') }}</button>
          <button v-for="group in groups" :key="group.id" type="button" :aria-pressed="groupId === group.id" @click="groupId = group.id">{{ group.name }}</button>
        </div>
        <div v-if="selectedGroup" class="qpa-toolbar">
          <button type="button" class="qpa-button" @click="editGroup(selectedGroup)">{{ tt('editGroup') }}</button>
          <button type="button" class="qpa-button" @click="show('removeGroup', selectedGroup)">{{ tt('removeGroup') }}</button>
        </div>
      </aside>

      <section class="qpa-pane qpa-list" :aria-label="tt('presets')">
        <div class="qpa-pane-heading">
          <div class="qpa-toolbar" :aria-label="tt('presets')" role="group">
            <button type="button" class="qpa-button" :aria-pressed="!archived" @click="setArchive(false)">{{ tt('current') }}</button>
            <button type="button" class="qpa-button" :aria-pressed="archived" @click="setArchive(true)">{{ tt('archive') }}</button>
          </div>
          <button class="qpa-button qpa-primary" type="button" :disabled="loading || !!loadError" @click="editPreset()">
            <ClientIcon name="plus" /> {{ tt('newPreset') }}
          </button>
        </div>
        <label class="qpa-search">
          <ClientIcon name="search" />
          <input v-model="query" type="search" :aria-label="tt('search')" :placeholder="tt('search')" />
        </label>
        <p v-if="notice" class="qpa-notice" role="status">{{ notice }}</p>
        <div v-if="loading" class="qpa-empty" role="status"><BrandLoader :size="40" /><p>{{ tt('loading') }}</p></div>
        <div v-else-if="loadError" class="qpa-empty" role="alert">
          <p>{{ loadError }}</p>
          <button type="button" class="qpa-button" @click="load">{{ tt('refresh') }}</button>
        </div>
        <p v-else-if="!filtered.length" class="qpa-empty" role="status">{{ tt('empty') }}</p>
        <div v-else class="qpa-cards">
          <article v-for="row in filtered" :key="row.id" class="qpa-card">
            <div class="qpa-card-header">
              <span class="qpa-category">{{ row.group?.name ?? tt('ungrouped') }}</span>
              <span v-if="!archived" class="qpa-badge" :class="{enabled: row.enabled}">{{ tt(row.enabled ? 'enabled' : 'disabled') }}</span>
            </div>
            <h3>{{ row.title }}</h3>
            <p class="qpa-excerpt">{{ row.prompt }}</p>
            <div class="qpa-toolbar">
              <button v-if="archived" type="button" class="qpa-button" @click="show('restore', row)">{{ tt('restore') }}</button>
              <template v-else>
                <button type="button" class="qpa-button" @click="editPreset(row)">{{ tt('edit') }}</button>
                <button type="button" class="qpa-button" @click="show(row.enabled ? 'disable' : 'enable', row)">{{ tt(row.enabled ? 'disable' : 'enable') }}</button>
                <button type="button" class="qpa-button" @click="show('archivePreset', row)">{{ tt('archivePreset') }}</button>
              </template>
            </div>
          </article>
        </div>
      </section>
    </div>

    <dialog ref="dialog" class="qpa-dialog" :aria-label="modalTitle" @cancel.prevent="close" @close="onDialogClose">
      <article v-if="action">
        <header class="qpa-pane-heading">
          <h2>{{ modalTitle }}</h2>
          <button type="button" class="qpa-button qpa-close" :aria-label="tt('cancel')" :disabled="saving" @click="close"><ClientIcon name="close" /></button>
        </header>
        <form @submit.prevent="save">
          <fieldset v-if="action.kind === 'preset'" class="qpa-form" :disabled="saving">
            <label>{{ tt('name') }}<input v-model="draft.title" required maxlength="64" /></label>
            <label>{{ tt('prompt') }}<textarea v-model="draft.prompt" required maxlength="8000" rows="6" /></label>
            <div class="qpa-columns">
              <label>{{ tt('group') }}<select v-model="draft.groupId"><option value="">{{ tt('ungrouped') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
              <label>{{ tt('order') }}<input v-model.number="draft.sort" type="number" step="1" required /></label>
            </div>
            <label class="qpa-checkbox"><input v-model="draft.enabled" type="checkbox" />{{ tt('visibleInChat') }}</label>
          </fieldset>
          <fieldset v-else-if="action.kind === 'group'" class="qpa-form" :disabled="saving">
            <label>{{ tt('group') }}<input v-model="draft.name" maxlength="32" required /></label>
            <label>{{ tt('order') }}<input v-model.number="draft.sort" type="number" step="1" required /></label>
          </fieldset>
          <section v-else class="qpa-confirm">
            <h3>{{ action.row.title ?? action.row.name }}</h3>
            <p>{{ tt(action.kind + 'Note') }}</p>
          </section>
          <p v-if="saveError" class="qpa-error" role="alert">{{ saveError }}</p>
          <footer class="qpa-toolbar">
            <button type="button" class="qpa-button" :disabled="saving" @click="close">{{ tt('cancel') }}</button>
            <button type="submit" class="qpa-button qpa-primary" :disabled="saving || needsRefresh">{{ tt(saving ? 'saving' : 'confirm') }}</button>
          </footer>
        </form>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import {computed, nextTick, onUnmounted, ref, watch} from 'vue';
import {api} from '../../api/client.js';
import {useAuth} from '../../stores/auth.js';
import {currentLang} from '../../i18n/index.js';
import ClientIcon from '../../components/reference/ClientIcon.vue';
import BrandLoader from '../../components/design/BrandLoader.vue';
import './preset-studio.css';

const messages = {
  studio: ['预设工作台', '預設工作台', 'Preset studio'],
  intro: ['整理给对话使用的提示词，让好问题有一个起点。', '整理供對話使用的提示詞，讓好問題有個起點。', 'Organize starting points for better conversations.'],
  presets: ['提示词', '提示詞', 'Prompts'],
  groups: ['分组导航', '分組導覽', 'Prompt groups'],
  group: ['分组', '分組', 'Group'],
  all: ['全部分组', '所有分組', 'All groups'],
  ungrouped: ['未分组', '未分組', 'Ungrouped'],
  current: ['使用中', '使用中', 'Current'],
  archive: ['回收站', '資源回收筒', 'Archive'],
  newPreset: ['新增预设', '新增預設', 'New preset'],
  newGroup: ['新增分组', '新增分組', 'New group'],
  editGroup: ['编辑分组', '編輯分組', 'Edit group'],
  removeGroup: ['移除分组', '移除分組', 'Remove group'],
  removeGroupNote: ['组内的预设会移到未分组，内容会保留。', '組內的預設會移到未分組，內容會保留。', 'The prompts will move to Ungrouped. Their content is retained.'],
  search: ['搜索名称或提示词', '搜尋名稱或提示詞', 'Search names or prompt text'],
  refresh: ['重新读取', '重新讀取', 'Read again'],
  loading: ['正在读取目录…', '正在讀取目錄…', 'Loading the catalog…'],
  loadError: ['暂时无法读取目录。', '暫時無法讀取目錄。', 'The catalog is temporarily unavailable.'],
  empty: ['没有符合条件的预设。', '沒有符合條件的預設。', 'No matching presets.'],
  enabled: ['已启用', '已啟用', 'Enabled'],
  disabled: ['已停用', '已停用', 'Disabled'],
  enable: ['启用', '啟用', 'Enable'],
  enableNote: ['启用后，这条提示词会出现在对话提示词库。', '啟用後，這條提示詞會出現在對話提示詞庫。', 'Enable this prompt in the conversation library.'],
  disable: ['停用', '停用', 'Disable'],
  disableNote: ['停用后，这条提示词会从对话提示词库隐藏。', '停用後，這條提示詞會從對話提示詞庫隱藏。', 'Hide this prompt from the conversation library.'],
  edit: ['编辑预设', '編輯預設', 'Edit preset'],
  archivePreset: ['移入回收站', '移至資源回收筒', 'Archive preset'],
  archivePresetNote: ['收起后可以在回收站查看和恢复。', '收起後可在資源回收筒查看和還原。', 'You can view and restore this preset in the archive.'],
  restore: ['恢复预设', '還原預設', 'Restore preset'],
  restoreNote: ['恢复后保留当前分组、内容和启停状态。', '還原後保留目前分組、內容和啟停狀態。', 'Restore the preset with its current group, content and visibility.'],
  name: ['预设名称', '預設名稱', 'Preset name'],
  prompt: ['提示词全文', '提示詞全文', 'Full prompt'],
  order: ['排序', '排序', 'Order'],
  visibleInChat: ['在对话提示词库显示', '在對話提示詞庫顯示', 'Show in the prompt library'],
  cancel: ['关闭', '關閉', 'Close'],
  confirm: ['确认', '確認', 'Confirm'],
  saving: ['正在保存…', '正在儲存…', 'Saving…'],
  saved: ['调整已保存。', '調整已儲存。', 'Changes saved.'],
  invalid: ['请填写名称、内容和有效排序。', '請填寫名稱、內容和有效排序。', 'Enter a name, the content and a valid order.'],
  duplicate: ['这个分组名称已经存在。', '這個分組名稱已經存在。', 'This group name already exists.'],
  conflict: ['这项内容已有变化。关闭后会读取最新版本。', '這項內容已有變更。關閉後會讀取最新版本。', 'This entry changed. Close to load the latest version.'],
  unknown: ['本次结果还未确认。关闭后请核对列表。', '本次結果尚未確認。關閉後請核對清單。', 'The result is unconfirmed. Close and check the list.'],
  saveError: ['未能保存这次调整。', '未能儲存這次調整。', 'These changes could not be saved.'],
};
const tt = key => messages[key][currentLang.value === 'en' ? 2 : currentLang.value === 'zh-TW' ? 1 : 0];
const auth = useAuth();
const rows = ref([]);
const groups = ref([]);
const groupId = ref(null);
const archived = ref(false);
const query = ref('');
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');
const needsRefresh = ref(false);
const notice = ref('');
const dialog = ref(null);
const action = ref(null);
const draft = ref({});
let readRequest;
let active = true;
let accountGeneration = 0;

const selectedGroup = computed(() => groups.value.find(group => group.id === groupId.value));
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return rows.value.filter(row => {
    if (groupId.value !== null && (row.groupId ?? '') !== groupId.value) return false;
    return !search || [row.title, row.prompt, row.group?.name ?? ''].some(text => text.toLocaleLowerCase().includes(search));
  });
});
const modalTitle = computed(() => {
  const value = action.value;
  if (!value) return tt('studio');
  if (value.kind === 'preset') return tt(value.row ? 'edit' : 'newPreset');
  if (value.kind === 'group') return tt(value.row ? 'editGroup' : 'newGroup');
  return tt(value.kind);
});

async function load() {
  if (!auth.isAdmin) return;
  readRequest?.abort();
  const request = new AbortController();
  readRequest = request;
  loading.value = true;
  loadError.value = '';
  const params = {signal: request.signal, retry: false};
  const path = archived.value ? '/presets/admin?archive=1' : '/presets/admin';
  try {
    const [items, groupList] = await Promise.all([api.get(path, params), api.get('/presets/groups', params)]);
    if (readRequest !== request) return;
    if (!Array.isArray(items) || !Array.isArray(groupList)) throw new Error('Invalid preset catalog');
    rows.value = items;
    groups.value = groupList;
    if (groupId.value && !groupList.some(group => group.id === groupId.value)) groupId.value = null;
  } catch {
    if (readRequest === request) loadError.value = tt('loadError');
  } finally {
    if (readRequest === request) {
      readRequest = null;
      loading.value = false;
    }
  }
}

function setArchive(value) {
  if (archived.value === value) return;
  archived.value = value;
  rows.value = [];
  notice.value = '';
  void load();
}

async function show(kind, row = null, fields = {}) {
  if (!auth.isAdmin || saving.value || loading.value || action.value) return;
  action.value = {kind, row};
  draft.value = fields;
  saveError.value = '';
  needsRefresh.value = false;
  notice.value = '';
  await nextTick();
  if (action.value && dialog.value && !dialog.value.open) dialog.value.showModal();
}

function editPreset(row = null) {
  show('preset', row, {
    title: row?.title ?? '',
    prompt: row?.prompt ?? '',
    groupId: row?.groupId ?? (archived.value ? '' : groupId.value || ''),
    sort: row?.sort ?? 0,
    enabled: row?.enabled ?? true,
  });
}

function editGroup(row = null) {
  show('group', row, {name: row?.name ?? '', sort: row?.sort ?? 0});
}

function close() {
  if (saving.value) return;
  dialog.value?.close();
  onDialogClose();
}

function onDialogClose() {
  if (dialog.value?.open || !action.value) return;
  action.value = null;
  draft.value = {};
  if (needsRefresh.value) void load();
}

async function submitAction(kind, row, fields) {
  const noRetry = {retry: false};
  const id = row ? encodeURIComponent(row.id) : '';
  const revision = row ? {expectedUpdatedAt: row.updatedAt} : {};
  switch (kind) {
    case 'preset': {
      const payload = {...fields, groupId: fields.groupId || null};
      return row
        ? api.patch('/presets/' + id, {...payload, ...revision}, noRetry)
        : api.post('/presets', payload, noRetry);
    }
    case 'group':
      return row
        ? api.patch('/presets/groups/' + id, {...fields, ...revision}, noRetry)
        : api.post('/presets/groups', fields, noRetry);
    case 'enable':
    case 'disable':
      return api.patch('/presets/' + id, {enabled: kind === 'enable', ...revision}, noRetry);
    case 'archivePreset':
    case 'removeGroup': {
      const prefix = kind === 'removeGroup' ? '/presets/groups/' : '/presets/';
      return api.del(prefix + id + '?' + new URLSearchParams(revision), noRetry);
    }
    case 'restore':
      return api.post('/presets/' + id + '/restore', revision, noRetry);
  }
}

async function save() {
  if (saving.value || needsRefresh.value || !action.value || !auth.isAdmin) return;
  const {kind, row} = action.value;
  const fields = {...draft.value};
  if ((kind === 'preset' && (!fields.title.trim() || !fields.prompt.trim() || !Number.isInteger(fields.sort)))
    || (kind === 'group' && (!fields.name.trim() || !Number.isInteger(fields.sort)))) {
    saveError.value = tt('invalid');
    return;
  }
  const generation = accountGeneration;
  const stillCurrent = () => active && generation === accountGeneration;
  saving.value = true;
  saveError.value = '';
  try {
    await submitAction(kind, row, fields);
    if (!stillCurrent()) return;
    saving.value = false;
    close();
    if (kind === 'preset' && !row) archived.value = false;
    notice.value = tt('saved');
    await load();
  } catch (error) {
    if (!stillCurrent()) return;
    if (kind === 'group' && error?.message === '分组名称已存在') {
      saveError.value = tt('duplicate');
    } else if (error?.status === 404 || error?.status === 409) {
      needsRefresh.value = true;
      saveError.value = tt('conflict');
    } else if (!error?.status || error.status >= 500) {
      needsRefresh.value = true;
      saveError.value = tt('unknown');
    } else {
      saveError.value = tt('saveError');
    }
  } finally {
    if (stillCurrent()) saving.value = false;
  }
}

watch([() => auth.identityRevision, () => auth.isAdmin], async () => {
  const generation = ++accountGeneration;
  readRequest?.abort();
  readRequest = null;
  rows.value = [];
  groups.value = [];
  action.value = null;
  draft.value = {};
  groupId.value = null;
  archived.value = false;
  query.value = '';
  saving.value = false;
  loading.value = false;
  notice.value = '';
  saveError.value = '';
  needsRefresh.value = false;
  loadError.value = '';
  dialog.value?.close();
  await nextTick();
  if (active && generation === accountGeneration && auth.isAdmin) void load();
}, {immediate: true, flush: 'sync'});
onUnmounted(() => {
  active = false;
  readRequest?.abort();
  readRequest = null;
});
</script>
