export const ACCOUNT_AVATARS = Object.freeze([
  { id: 'qgauss:violet', name: '紫雾搭档', tone: 'violet' },
  { id: 'qgauss:lime', name: '青柠搭档', tone: 'lime' },
  { id: 'qgauss:coral', name: '珊瑚搭档', tone: 'coral' },
  { id: 'qgauss:orbit', name: '星海搭档', tone: 'orbit' },
]);

export function accountAvatar(value) {
  return ACCOUNT_AVATARS.find(item => item.id === value) || ACCOUNT_AVATARS[0];
}

export function accountDate(value,lang='zh-CN') {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '暂无记录';
  return new Intl.DateTimeFormat(lang==='en'?'en-US':lang==='zh-TW'?'zh-TW':'zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function loginDevice(value,lang='zh-CN') {
  const ua = String(value || '');
  const system = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS / iPadOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : lang==='en'?'Browser':lang==='zh-TW'?'瀏覽器':'浏览器';
  return [browser, system].filter(Boolean).join(' · ');
}

export function passwordProblem(oldPassword, password, confirmation, changing = true, administrator = false) {
  if (changing && !oldPassword) return '请先填写当前密码。';
  if (typeof password !== 'string' || [...password].length < 8 || [...password].length > 32) return '新密码需要 8–32 个字符。';
  if (new TextEncoder().encode(password).length > 72) return '密码中的多字节字符过多，请减少表情或特殊字符。';
  if (administrator && ([...password].length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)
    || /change[-_ ]?(me|this)|dev[-_ ]?secret|please[-_ ]?change|your[-_ ].*(secret|key)|replace[-_ ]?(me|this)|insecure/i.test(password))) return '管理员新密码需为 12–32 个字符，包含英文字母和数字，且不能使用示例密码。';
  if (changing && password === oldPassword) return '请使用与当前密码不同的新密码。';
  if (password !== confirmation) return '两次填写的新密码不一致。';
  return '';
}
