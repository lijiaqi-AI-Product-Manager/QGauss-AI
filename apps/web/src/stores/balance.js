/**
 * 四类额度与钱包余额（顶栏与对话页共享快照）
 *
 * 为什么不做成 pinia store：这里只有一份只读快照 + 一个刷新动作，
 * 模块级 reactive 就够用，还能在组件外（如 SSE 回调里）直接调用。
 *
 * 商业化关闭时后端返回 404，这里静默降级为 enabled=false，
 * 顶栏不显示入口，也不弹错误提示。
 */
import { computed, reactive } from 'vue';
import { api } from '../api/client.js';

const EMPTY = { model3: 0, model4: 0, drawMj: 0, agent: 0 };

const state = reactive({
  enabled: false,
  loaded: false,
  loading: false,
  error: '',
  counts: { ...EMPTY },
  member: { ...EMPTY },
  paid: { ...EMPTY },
  balanceCents: 0,
  isMember: false,
  expirationTime: null,
});

const balanceYuan = computed(() => (state.balanceCents / 100).toFixed(2));

const tooltip = computed(() => {
  if (!state.enabled) return '';
  const c = state.counts;
  const parts = [
    `低价模型 ${c.model3 || 0}`,
    `高价模型 ${c.model4 || 0}`,
    `绘图 ${c.drawMj || 0}`,
    `智能体 ${c.agent || 0}`,
  ];
  const tail = state.isMember ? `｜会员至 ${formatDate(state.expirationTime)}` : '';
  return `${parts.join(' · ')}｜余额 ¥${balanceYuan.value}${tail}`;
});

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 公开配置里的商业化开关：明确关闭时连请求都不发，免得控制台里一串 404
let commerceOff = false;
let revision = 0, request = null;

function setCommerceEnabled(enabled) {
  commerceOff = !enabled;
  if (commerceOff) reset();
}

async function refresh() {
  if (state.loading || commerceOff) return;
  const version = revision, controller = new AbortController();
  request = controller;
  const current = () => version === revision && request === controller && !controller.signal.aborted;
  state.loading = true;
  try {
    const data = await api.get('/balance/query', { signal: controller.signal });
    if (!current()) return;
    state.enabled = true;
    state.error = '';
    state.counts = { ...EMPTY, ...(data?.counts || {}) };
    state.member = { ...EMPTY, ...(data?.member || {}) };
    state.paid = { ...EMPTY, ...(data?.paid || {}) };
    state.balanceCents = Number(data?.balanceCents || 0);
    state.isMember = !!data?.isMember;
    state.expirationTime = data?.expirationTime ?? null;
  } catch (e) {
    if (!current()) return;
    // 404 = 商业化关闭；其余错误保留上一次快照，只记录错误
    if (e?.status === 404 || e?.code === 8001) {
      state.enabled = false;
      state.counts = { ...EMPTY };
    } else {
      state.error = e?.message || '余额查询失败';
    }
  } finally {
    if (current()) {
      state.loading = false;
      state.loaded = true;
      request = null;
    }
  }
}

/** 登出时清空，避免下一个账号看到上一个人的余额 */
function reset() {
  revision += 1;
  request?.abort();
  request = null;
  state.loading = false;
  state.enabled = false;
  state.loaded = false;
  state.counts = { ...EMPTY };
  state.member = { ...EMPTY };
  state.paid = { ...EMPTY };
  state.balanceCents = 0;
  state.isMember = false;
  state.expirationTime = null;
  state.error = '';
}

export function useBalance() {
  return { state, balanceYuan, tooltip, refresh, reset, setCommerceEnabled };
}
