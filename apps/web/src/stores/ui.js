/** 跨组件的界面状态：沉浸、会话抽屉、标题及真实回复阶段 */
import { ref } from 'vue';

const immersive = ref(false);
const clientNavigationOpen = ref(false);
const clientChatTitle = ref('');
const chatActivity = ref('idle');

export function useUi() {
  return { immersive, clientNavigationOpen, clientChatTitle, chatActivity };
}
