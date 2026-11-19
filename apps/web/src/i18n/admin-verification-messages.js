import { currentLang } from './index.js';

const copy = {
  title: ['管理员两步验证', '管理員兩步驗證', 'Admin two-step verification'],
  signIn: ['完成第二步，继续登录', '完成第二步，繼續登入', 'Complete your sign-in'],
  signInIntro: ['输入验证器当前显示的六位验证码。也可使用一枚恢复码。', '輸入驗證器目前顯示的六位驗證碼。也可使用一枚復原碼。', 'Enter the six-digit code from your authenticator, or use a recovery code.'],
  factorCode: ['验证器验证码', '驗證器驗證碼', 'Authenticator code'],
  recoveryCode: ['一次性恢复码', '一次性復原碼', 'One-time recovery code'],
  useRecovery: ['改用恢复码', '改用復原碼', 'Use a recovery code'],
  useFactor: ['改用验证器', '改用驗證器', 'Use the authenticator'],
  verify: ['验证并继续', '驗證並繼續', 'Verify and continue'],
  signOut: ['取消并退出', '取消並登出', 'Cancel and sign out'],
  working: ['正在确认…', '正在確認…', 'Verifying…'],
  intro: ['为此管理员账号的每次新登录增加一步验证。', '為此管理員帳號的每次新登入增加一步驗證。', 'Add a verification step to every new sign-in for this admin account.'],
  enabled: ['已开启', '已啟用', 'Enabled'],
  notEnabled: ['待开启', '待啟用', 'Off'],
  setup: ['设置验证器', '設定驗證器', 'Set up authenticator'],
  switchFactor: ['更换验证器', '更換驗證器', 'Replace authenticator'],
  replaceCodes: ['换领恢复码', '換領復原碼', 'Replace recovery codes'],
  disable: ['停用两步验证', '停用兩步驗證', 'Turn off verification'],
  count: ['可用恢复码 {count} 枚', '可用復原碼 {count} 枚', 'Recovery codes left: {count}'],
  needPassword: ['请先在安全页设置登录密码。', '請先在安全頁設定登入密碼。', 'Set a sign-in password in Security first.'],
  reading: ['正在读取设置…', '正在讀取設定…', 'Loading settings…'],
  retry: ['重新读取', '重新讀取', 'Reload'],
  password: ['当前账号密码', '目前帳號密碼', 'Current account password'],
  currentProof: ['当前验证码或恢复码', '目前驗證碼或復原碼', 'Current authenticator or recovery code'],
  expireOthers: ['确认后，其他设备上的登录将退出。', '確認後，其他裝置上的登入將登出。', 'Confirming signs out your other devices.'],
  replaceWarning: ['确认后，之前的恢复码会失效。', '確認後，先前的復原碼將失效。', 'Confirming invalidates the previous recovery codes.'],
  next: ['继续', '繼續', 'Continue'],
  cancel: ['取消', '取消', 'Cancel'],
  close: ['完成', '完成', 'Done'],
  pairTitle: ['在验证器里添加 QGauss AI', '在驗證器中新增 QGauss AI', 'Add QGauss AI to your authenticator'],
  pairInstructions: ['使用时间型验证码。添加密钥后，填入验证器显示的六位验证码完成配对。', '使用時間型驗證碼。新增金鑰後，填入驗證器顯示的六位驗證碼完成配對。', 'Choose time-based codes. Add the setup key, then enter the six-digit code shown in your authenticator.'],
  pairExpiry: ['配对有效期至 {time}', '配對有效期至 {time}', 'Pairing available until {time}'],
  key: ['设置密钥', '設定金鑰', 'Setup key'],
  copyKey: ['复制密钥', '複製金鑰', 'Copy key'],
  openApp: ['打开验证器', '開啟驗證器', 'Open authenticator'],
  confirmPair: ['确认配对', '確認配對', 'Finish pairing'],
  saved: ['保存你的恢复码', '儲存你的復原碼', 'Save your recovery codes'],
  saveHint: ['恢复码仅在这里显示一次。请放到只有你能访问的地方，每枚可用一次。', '復原碼僅在這裡顯示一次。請存放在只有你能存取的位置，每枚可用一次。', 'These codes are shown once. Keep them somewhere private. Each code works once.'],
  copyCodes: ['复制恢复码', '複製復原碼', 'Copy recovery codes'],
  downloadCodes: ['下载恢复码', '下載復原碼', 'Download codes'],
  copied: ['已复制', '已複製', 'Copied'],
  copyUnavailable: ['请选中文字手动复制。', '請選取文字手動複製。', 'Select the text to copy it manually.'],
  updated: ['两步验证已开启。', '兩步驗證已啟用。', 'Two-step verification is enabled.'],
  codesReplaced: ['恢复码已换领。', '復原碼已換領。', 'Recovery codes replaced.'],
  disabled: ['两步验证已停用。', '兩步驗證已停用。', 'Two-step verification is off.'],
  invalid: ['验证码或恢复码无效、已使用或已过期。', '驗證碼或復原碼無效、已使用或已過期。', 'This code is invalid, expired, or already used.'],
  invalidPassword: ['请检查当前账号密码。', '請檢查目前帳號密碼。', 'Check your current account password.'],
  rateLimited: ['尝试次数过多，请稍后再试。', '嘗試次數過多，請稍後再試。', 'Too many attempts. Try again shortly.'],
  changed: ['当前设置已变化，请重新读取。', '目前設定已變更，請重新讀取。', 'Your settings changed. Reload and try again.'],
  sessionExpired: ['这次登录已过期，请重新登录。', '這次登入已過期，請重新登入。', 'This sign-in expired. Please sign in again.'],
  unavailable: ['暂时无法完成，请稍后重试。', '暫時無法完成，請稍後重試。', 'Something interrupted the verification. Please try again.'],
};

export function verificationText(key, values = {}) {
  const index = currentLang.value === 'en' ? 2 : currentLang.value === 'zh-TW' ? 1 : 0;
  return (copy[key]?.[index] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

export function verificationError(error) {
  if (error?.code === 2013) return 'invalid';
  if (error?.code === 2005) return 'invalidPassword';
  if (error?.status === 429) return 'rateLimited';
  if (error?.status === 409) return 'changed';
  if (error?.status === 401) return 'sessionExpired';
  return 'unavailable';
}
