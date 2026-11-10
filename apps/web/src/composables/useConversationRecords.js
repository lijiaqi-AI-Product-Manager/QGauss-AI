import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { api, fetchBlob } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import { RECORD_FILTERS, recordQuery, recordPath, readRecordPage, checkWorkbook, saveRecordWorkbook } from '../lib/conversation-records.js';

export function useConversationRecords({ client = api, download = fetchBlob, save = saveRecordWorkbook, auth = useAuth() } = {}) {
  const filters = reactive({ ...RECORD_FILTERS }), rows = ref([]), total = ref(0), page = ref(1), pageSize = 20;
  const loading = ref(false), error = ref(''), applied = ref(null), appliedDraft = ref(''), exporting = ref(false), exportError = ref(''), exportNotice = ref('');
  const selectedId = ref(''), detail = ref(null), detailLoading = ref(false), detailError = ref('');
  const dirty = computed(() => !!applied.value && JSON.stringify(filters) !== appliedDraft.value);
  const allowed = () => alive && auth.isLoggedIn && auth.user?.role === 'ADMIN';
  let alive = true, ticket = 0, listRead, detailRead, exportRead, lastAttempt;
  const current = (request, identity) => allowed() && !request.signal.aborted && identity === auth.identityRevision;
  function closeDetail() { detailRead?.abort(); detailRead = undefined; selectedId.value = ''; detail.value = null; detailError.value = ''; detailLoading.value = false; }
  function cancelExport() { exportRead?.abort(); exportRead = undefined; exporting.value = false; }
  function clear() {
    ticket++; listRead?.abort(); listRead = undefined; closeDetail(); cancelExport();
    rows.value = []; total.value = 0; page.value = 1; applied.value = null; appliedDraft.value = '';
    loading.value = false; error.value = ''; exportError.value = ''; exportNotice.value = ''; lastAttempt = undefined;
  }
  async function load(query, targetPage, reset = false, draft = appliedDraft.value) {
    if (!allowed()) return false;
    const sequence = ++ticket, request = new AbortController(), identity = auth.identityRevision;
    listRead?.abort(); listRead = request; closeDetail(); cancelExport(); loading.value = true; error.value = ''; exportError.value = ''; exportNotice.value = '';
    lastAttempt = { query: { ...query }, targetPage, reset, draft };
    if (reset) { rows.value = []; total.value = 0; page.value = 1; applied.value = null; }
    try {
      const data = readRecordPage(await client.get(recordPath(query, { page: targetPage, pageSize }), { signal: request.signal }), targetPage, pageSize);
      if (!current(request, identity) || sequence !== ticket) return false;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (targetPage > lastPage) return load({ ...query, asOf: data.asOf }, lastPage, reset, draft);
      rows.value = data.items; total.value = data.total; page.value = targetPage;
      applied.value = { ...query, asOf: data.asOf }; appliedDraft.value = draft; return true;
    } catch (cause) {
      if (current(request, identity) && sequence === ticket) error.value = cause.status === 403 ? '当前账号无权查看记录' : '记录暂未读取完整，请重试';
      return false;
    } finally { if (listRead === request) { listRead = undefined; loading.value = false; } }
  }
  async function search() {
    try { return await load(recordQuery(filters), 1, true, JSON.stringify(filters)); }
    catch (cause) { error.value = cause.message; return false; }
  }
  const reset = () => { Object.assign(filters, RECORD_FILTERS); return search(); };
  const retry = () => lastAttempt ? load(lastAttempt.query, lastAttempt.targetPage, lastAttempt.reset, lastAttempt.draft) : search();
  const goPage = target => applied.value && !loading.value && Number.isSafeInteger(target) && target > 0 && target <= Math.max(1, Math.ceil(total.value / pageSize)) ? load({ ...applied.value }, target) : false;
  async function openDetail(id) {
    if (!allowed() || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return false;
    detailRead?.abort(); const request = new AbortController(), identity = auth.identityRevision; detailRead = request;
    selectedId.value = id; detail.value = null; detailError.value = ''; detailLoading.value = true;
    try {
      const data = await client.get('/chat-logs/' + encodeURIComponent(id), { signal: request.signal });
      if (!current(request, identity) || detailRead !== request) return false;
      if (!data || data.id !== id || typeof data.content !== 'string' || !Array.isArray(data.branches) || !Number.isSafeInteger(data.branchCount) || data.branchCount < data.branches.length) throw new Error('incomplete record');
      detail.value = data; return true;
    } catch (cause) { if (current(request, identity) && detailRead === request) detailError.value = cause.status === 404 ? '记录不存在或已移除' : '消息明细暂未打开，请重试'; return false; }
    finally { if (detailRead === request) { detailRead = undefined; detailLoading.value = false; } }
  }
  const canExport = computed(() => !!applied.value && total.value > 0 && total.value <= 20_000 && !loading.value && !exporting.value);
  async function exportExcel() {
    if (!allowed() || !canExport.value) return false;
    const query = { ...applied.value }, request = new AbortController(), identity = auth.identityRevision; exportRead = request;
    exporting.value = true; exportError.value = ''; exportNotice.value = '';
    try {
      const blob = await checkWorkbook(await download('/api' + recordPath(query, { exportFile: true }), { signal: request.signal }));
      if (!current(request, identity) || exportRead !== request) return false;
      save(blob); exportNotice.value = '文件已准备好，已交给浏览器下载'; return true;
    } catch (cause) { if (current(request, identity) && exportRead === request) exportError.value = cause.status === 403 ? '当前账号无权导出记录' : '文件暂未完整下载，请重试或缩小筛选范围'; return false; }
    finally { if (exportRead === request) { exportRead = undefined; exporting.value = false; } }
  }
  watch(() => [auth.identityRevision, auth.user?.id, auth.user?.role, auth.isLoggedIn], () => { clear(); Object.assign(filters, RECORD_FILTERS); }, { flush: 'sync' });
  onScopeDispose(() => { clear(); alive = false; });
  return { filters, rows, total, page, pageSize, loading, error, applied, dirty, exporting, exportError, exportNotice, canExport,
    selectedId, detail, detailLoading, detailError, search, reset, retry, goPage, openDetail, closeDetail, exportExcel, cancelExport };
}
