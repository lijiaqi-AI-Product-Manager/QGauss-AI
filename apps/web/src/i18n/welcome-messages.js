import { currentLang } from './index.js';

const messages = {
  title: ['把空间布置好，', '把空間布置好，', 'Set up your workspace.'],
  titleAccent: ['再让灵感起飞。', '再讓靈感起飛。', 'Start creating.'],
  intro: ['从首次创作到邀请用户，逐步核对空间的开放条件。', '從首次創作到邀請使用者，逐步核對空間的開放條件。', 'Check what your workspace needs, from the first creation to inviting users.'],
  loading: ['正在核对你的空间', '正在核對你的空間', 'Checking your workspace'],
  loadError: ['清单暂时无法读取。', '清單暫時無法讀取。', 'The checklist is unavailable.'],
  retry: ['重新读取', '重新讀取', 'Try again'],
  modelPresent: ['选个想法，和创作搭档聊聊。', '選個想法，和創作搭檔聊聊。', 'Bring an idea to your creative partner.'],
  modelEmpty: ['选择一个创作搭档。', '選擇一個創作搭檔。', 'Choose a creative partner.'],
  modelDetail: ['请试一次实际对话，确认回答质量和速度。', '請試一次實際對話，確認回答品質和速度。', 'Start a conversation to check response quality and speed.'],
  modelEmptyDetail: ['连接真实模型，或开启离线的本地体验。', '連接真實模型，或開啟離線的本機體驗。', 'Connect a live model or enable the offline demo.'],
  chat: ['打开对话工作区', '開啟對話工作區', 'Open the chat workspace'],
  connect: ['连接模型服务', '連接模型服務', 'Connect a model'],
  checklist: ['首次创作检查', '首次創作檢查', 'First creation checklist'],
  ready: ['已完成', '已完成', 'Complete'],
  configured: ['已配置 · 待体验', '已設定 · 待體驗', 'Configured · test pending'],
  action: ['下一小步', '下一小步', 'Next step'],
  optional: ['按需准备', '依需求準備', 'Optional'],
  missing: ['等待布置', '等待布置', 'Setup needed'],
  unknown: ['待确认', '待確認', 'Awaiting confirmation'],
  demoTitle: ['先和一位本地搭档打个招呼。', '先和一位本機搭檔打個招呼。', 'Say hello to the local demo.'],
  demoIntro: ['离线体验用来熟悉对话流程。启用后，你可以手动发送第一条消息。', '離線體驗用來熟悉對話流程。啟用後，你可以手動傳送第一則訊息。', 'Use the offline demo to learn the chat workflow. Send the first message when you’re ready.'],
  demoUncertain: ['开启结果尚未确认。请先重新读取清单，再决定下一步。', '開啟結果尚未確認。請先重新讀取清單，再決定下一步。', 'The result is still unknown. Refresh the checklist before trying again.'],
  checkAgain: ['重新核对状态', '重新核對狀態', 'Check status again'],
  demoReview: ['了解并开启本地体验', '了解並開啟本機體驗', 'Review local demo setup'],
  demoConfirm: ['确认向本站添加 QGauss 本地体验模型？', '確認向本站新增 QGauss 本機體驗模型？', 'Add the QGauss local demo model to this workspace?'],
  cancel: ['暂时不用', '暫時不用', 'Cancel'],
  enabling: ['正在准备', '正在準備', 'Preparing'],
  enable: ['确认开启本地体验', '確認開啟本機體驗', 'Enable the local demo'],
  demoConfigured: ['已有可用的对话配置，请从工作区选择模型。', '已有可用的對話設定，請從工作區選擇模型。', 'A chat model is configured. Choose it in the workspace.'],
  demoError: ['暂时无法开启，请核对后重试。', '暫時無法開啟，請核對後重試。', 'The demo could not be enabled. Check the status and try again.'],
  workspace: ['进入创作空间', '進入創作空間', 'Enter the workspace'],
  account: ['管理员账户', '管理員帳戶', 'Administrator account'],
  protect: ['请更换开发演示密码，再开放站点。', '請更換開發展示密碼，再開放站點。', 'Set your own administrator password before opening the site.'],
  protectDone: ['在账户设置核对登录方式与密码。', '在帳戶設定核對登入方式與密碼。', 'Review your sign-in methods and password in account settings.'],
  password: ['查看账户与密码', '查看帳戶與密碼', 'Account and password'],
  model: ['对话模型', '對話模型', 'Chat model'],
  demoModel: ['当前模型用于离线体验。', '目前的模型用於離線體驗。', 'The current model is for offline demos.'],
  modelSettings: ['查看模型配置', '查看模型設定', 'Model settings'],
  creation: ['第一份创作', '第一份創作', 'First creation'],
  creationDone: ['本账号已有保存完成的对话或绘画。', '本帳戶已有儲存完成的對話或繪畫。', 'This account has a saved conversation or image.'],
  creationNeeded: ['完成一次对话或绘画，成果会保存在你的空间。', '完成一次對話或繪畫，成果會儲存在你的空間。', 'Finish a conversation or create an image to save it to your workspace.'],
};

export function welcomeText(key) {
  return messages[key]?.[currentLang.value === 'en' ? 2 : currentLang.value === 'zh-TW' ? 1 : 0];
}

export function welcomeCheck(check, model) {
  const copy = {
    account: [check.state === 'ready' ? 'protectDone' : 'protect', 'password'],
    model: [model ? model.demo ? 'demoModel' : 'modelDetail' : 'modelEmptyDetail', model ? 'modelSettings' : 'connect'],
    creation: [check.state === 'ready' ? 'creationDone' : 'creationNeeded', 'chat'],
  }[check.id];
  if (!copy) return check;
  const [description, action] = copy;
  return {
    ...check,
    title: welcomeText(check.id),
    description: welcomeText(description),
    action: check.action && { ...check.action, label: welcomeText(action) },
  };
}
