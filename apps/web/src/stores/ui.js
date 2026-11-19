/** 跨组件的界面状态：沉浸、会话抽屉、标题及真实回复阶段 */
import { ref } from 'vue';

const immersive = ref(false);
const clientNavigationOpen = ref(false);
const clientNavigationPane = ref('pages');
const clientChatTitle = ref('');
const chatActivity = ref('idle');

function openClientNavigation(pane, trigger) {
  trigger?.focus({ preventScroll: true });
  clientNavigationPane.value = pane;
  clientNavigationOpen.value = true;
}

export function useUi() {
  return { immersive, clientNavigationOpen, clientNavigationPane, openClientNavigation, clientChatTitle, chatActivity };
}
