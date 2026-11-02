import { computed, ref } from 'vue';

const DICT = {
  zh: {
    'nav.chat': '对话',
    'nav.apps': '应用',
    'nav.image': '图像',
    'nav.statistic': '概览',
    logout: '退出',
    'login.subtitle': '自托管 AI 对话平台 · 多模型接入',
    'login.tab.login': '登录',
    'login.tab.register': '注册',
    'login.account': '邮箱或用户名',
    'login.password': '密码',
    'login.email': '邮箱',
    'login.username': '用户名（3-20 位）',
    'login.password.rule': '密码（8-32 位）',
    'login.captcha': '验证码',
    'login.submit': '登录',
    'login.register': '注册',
    'login.forgot': '忘记密码？',
    'login.forgot.title': '找回密码',
    'login.forgot.desc': '我们会向该邮箱发送重置链接（30 分钟内有效）。',
    'login.send': '发送',
    'common.cancel': '取消',
    'chat.new': '新对话',
    'chat.empty': '开始一段新对话',
    'chat.empty.hint': '从下面的预设里挑一个，或直接输入你的问题',
    'chat.input': '输入消息，Enter 发送，Shift+Enter 换行',
    'chat.send': '发送',
    'chat.stop': '停止',
    'chat.model': '选择模型',
    'chat.preset': '预设',
    'chat.quota': '今日',
  },
  en: {
    'nav.chat': 'Chat',
    'nav.apps': 'Apps',
    'nav.image': 'Images',
    'nav.statistic': 'Overview',
    logout: 'Sign out',
    'login.subtitle': 'Self-hosted AI chat platform · multi-provider',
    'login.tab.login': 'Sign in',
    'login.tab.register': 'Sign up',
    'login.account': 'Email or username',
    'login.password': 'Password',
    'login.email': 'Email',
    'login.username': 'Username (3-20 chars)',
    'login.password.rule': 'Password (8-32 chars)',
    'login.captcha': 'Captcha',
    'login.submit': 'Sign in',
    'login.register': 'Create account',
    'login.forgot': 'Forgot password?',
    'login.forgot.title': 'Reset password',
    'login.forgot.desc': 'We will email a reset link valid for 30 minutes.',
    'login.send': 'Send',
    'common.cancel': 'Cancel',
    'chat.new': 'New chat',
    'chat.empty': 'Start a new conversation',
    'chat.empty.hint': 'Pick a preset below, or just type your question',
    'chat.input': 'Type a message. Enter to send, Shift+Enter for newline',
    'chat.send': 'Send',
    'chat.stop': 'Stop',
    'chat.model': 'Model',
    'chat.preset': 'Presets',
    'chat.quota': 'Today',
  },
};

const lang = ref(localStorage.getItem('qg:lang') || 'zh');

export const currentLang = computed(() => lang.value);

export function setLang(next) {
  lang.value = next === 'en' ? 'en' : next === 'zh-TW' ? 'zh-TW' : 'zh';
  localStorage.setItem('qg:lang', lang.value);
  document.documentElement.lang = lang.value === 'en' ? 'en' : lang.value === 'zh-TW' ? 'zh-TW' : 'zh-CN';
}

export function toggleLang() {
  setLang(lang.value === 'zh' ? 'en' : 'zh');
}

export function t(key) {
  return DICT[lang.value]?.[key] ?? DICT.zh[key] ?? key;
}
