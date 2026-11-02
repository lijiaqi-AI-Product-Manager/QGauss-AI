import { defineComponent, h, ref } from 'vue';
import { useTheme } from '../../stores/theme.js';
import { authLanguage, setAuthLanguage } from './auth-locale.js';

// 只开放本项目已经具备的认证方式；外壳的状态和角色交互使用同一套场景实现。
export function useAuthConfig() { return { globalConfig: { emailLoginStatus: 1, wechatRegisterStatus: 0, phoneLoginStatus: 0 } }; }
export function useAuthSettings() { const theme = useTheme(); return { get isDark() { return theme.isDark.value; }, get language() { return authLanguage(); }, setLanguage: setAuthLanguage }; }
export function withScope(component, entries) { for (const [key, value] of entries) component[key] = value; return component; }
export const authMethodIcon = '';
export const UnavailableAuthMethod = defineComponent({ setup: () => () => h('p', '当前站点尚未配置此登录方式') });
export const AuthIcon = defineComponent({
  props: ['icon'],
  setup(props, { attrs }) {
    return () => h('svg', { ...attrs, viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'aria-hidden': true }, [
      h('path', { d: String(props.icon).includes('translate') ? 'M3 5h12M9 3v2c0 6-3 9-6 11m2-8c1 4 4 7 8 9m1 4 4-10 4 10m-6-4h4' : 'm6 6 12 12M18 6 6 18' }),
    ]);
  },
});
export const AuthButton = defineComponent({ setup: (_, { attrs, slots }) => () => h('button', { ...attrs, type: 'button' }, slots.default?.()) });
export const AuthPopover = defineComponent({
  props: ['show'], emits: ['update:show'],
  setup(props, { emit, slots }) {
    const root = ref(null);
    return () => h('div', { ref: root, class: 'qg-auth-popover', onFocusout: (event) => { if (!root.value?.contains(event.relatedTarget)) emit('update:show', false); } }, [
      h('span', { onClick: () => emit('update:show', !props.show) }, slots.trigger?.()),
      props.show ? h('div', { class: 'qg-auth-popover-content' }, slots.default?.()) : null,
    ]);
  },
});
