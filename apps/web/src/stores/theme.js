/**
 * 主题：默认跟随系统（prefers-color-scheme），用户手动切换后长期记住。
 * html 上挂 .dark 类，tokens.css 的令牌随之翻转；Element Plus 暗色变量也认这个类。
 */
import { computed, reactive } from 'vue';

const KEY = 'qg:theme';

const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function systemMode() {
  return media?.matches ? 'dark' : 'light';
}

function savedMode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* 隐私模式下 localStorage 可能抛错 */
  }
  return null;
}

const state = reactive({ mode: savedMode() ?? systemMode() });

function apply() {
  const dark = state.mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = state.mode;
  document.documentElement.style.colorScheme = state.mode;
}

function set(mode) {
  if (mode !== 'light' && mode !== 'dark') return;
  state.mode = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 忽略 */
  }
  apply();
}

function toggle() {
  set(state.mode === 'dark' ? 'light' : 'dark');
}

// 没手动选过时，系统切换深浅色要跟着走
media?.addEventListener?.('change', () => {
  if (savedMode()) return;
  state.mode = systemMode();
  apply();
});

apply();

export function useTheme() {
  return { state, isDark: computed(() => state.mode === 'dark'), set, toggle };
}
