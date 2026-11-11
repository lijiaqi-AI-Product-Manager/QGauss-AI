/**
 * 错误消息国际化
 *
 * 策略：中文是"原文"（业务异常里带的是具体中文描述），
 * 只有请求头声明英文时才用字典覆盖成通用英文文案。
 * 这样既保留了中文场景的上下文细节，又给非中文用户一个可读的兜底。
 */

export type Lang = 'zh' | 'en';

const ERROR_MESSAGES: Record<number, { zh: string; en: string }> = {
  1000: { zh: '未知错误', en: 'Unknown error' },
  1001: { zh: '参数不正确', en: 'Invalid parameters' },
  1002: { zh: '资源不存在', en: 'Not found' },
  1003: { zh: '请求过于频繁', en: 'Too many requests' },

  2001: { zh: '未登录或登录已过期', en: 'Not authenticated' },
  2002: { zh: '登录状态已失效', en: 'Session expired' },
  2003: { zh: '权限不足', en: 'Forbidden' },
  2004: { zh: '账号已被禁用', en: 'Account disabled' },
  2005: { zh: '账号或密码错误', en: 'Invalid credentials' },
  2006: { zh: '账号已存在', en: 'Account already exists' },
  2011: { zh: '短信服务暂未开放', en: 'Text message verification is not available yet. Linked numbers can still sign in with a password.' },

  3001: { zh: '模型不存在', en: 'Model not found' },
  3002: { zh: '暂无可用渠道', en: 'No available channel' },
  3003: { zh: '上游调用失败', en: 'Upstream request failed' },

  4001: { zh: '会话不存在', en: 'Conversation not found' },
  4011: {zh:'附件已不可用，请恢复文件或从编辑区移除后再发送',en:'An attachment is unavailable. Restore it or remove it from the composer before sending.'},
  4012: {zh:'附件内容暂不能读取，请更换文件或从编辑区移除',en:'An attachment could not be read. Replace it or remove it from the composer.'},
  4013: {zh:'文件暂未核对，请稍后重试。',en:'This file could not be checked. Please try again later.'},
  4014: {zh:'这段对话已变化，请刷新后再操作。',en:'This conversation has changed. Refresh it before continuing.'},
  4015: {zh:'当前记录已变化，请重新确认要整理的对话。',en:'These records have changed. Review the conversations again before continuing.'},
  4016: {zh:'这个分组已变化，请刷新后再操作。',en:'This collection has changed. Refresh it before continuing.'},

  5000: { zh: '服务器异常', en: 'Internal server error' },

  6001: { zh: '今日额度已用完', en: 'Daily quota exceeded' },
  6002: { zh: '会话正忙', en: 'Conversation is busy' },

  7001: { zh: '内容包含敏感词', en: 'Content blocked by moderation' },
  7002: { zh: '内容待审核', en: 'Content pending review' },
};

export function detectLang(acceptLanguage?: string): Lang {
  if (!acceptLanguage) return 'zh';
  return /^en\b/i.test(acceptLanguage.trim()) ? 'en' : 'zh';
}

export function translateError(code: number, lang: Lang, fallback: string): string {
  if (lang === 'zh') return fallback;
  if(Object.hasOwn(PHONE_ERRORS,fallback))return PHONE_ERRORS[fallback];
  return ERROR_MESSAGES[code]?.en ?? fallback;
}

const PHONE_ERRORS:Record<string,string>={
 '短信验证码错误、过期或已使用':'The text code is incorrect, expired, or already used.',
 '请填写有效的中国大陆手机号码。':'Enter a valid mainland China mobile number.',
 '请填写六位短信验证码。':'Enter the six-digit text message code.',
 '手机密码登录暂未开放，请使用其他登录方式。':'Phone sign-in is unavailable for now. Choose another method.',
 '注册暂未开放，已有账户仍可登录。':'Registration is closed for now. Existing accounts can still sign in.',
 '这次处理已有变化，请重新核对。':'This account request has changed. Check its latest result.',
 '这次申请已有变化，请重新核对。':'This text request has changed. Check its latest result.',
 '图形验证码错误或已过期，请刷新后再试':'The image code is incorrect or expired. Refresh it and try again.',
 '短信申请过于频繁，请稍后再试':'Text requests are too frequent. Try again later.',
 '请等待一分钟后再申请短信':'Wait one minute before requesting another text.',
 '今天的短信申请次数已用完，请稍后再试':'The text request limit for today has been reached. Try again later.',
 '短信申请较多，请稍后再试':'The text queue is busy. Try again later.',
 '号码或登录名已被使用，请核对后再试':'This number or username is already in use. Check your details.',
 '这个号码已经绑定当前账户':'This number is already linked to your account.',
 '这个号码当前无法绑定，请核对后再试':'This number cannot be linked right now. Check your details.',
 '当前密码不正确，请重新填写':'The current password is incorrect. Enter it again.',
 '当前登录已变化，请重新登录':'Your sign-in has changed. Sign in again.',
 '号码或密码已变更，请重新登录':'The phone number or password has changed. Sign in again.',
 '请重新读取当前资料后绑定号码':'Read your current account details before linking a number.',
 '未找到这次短信申请':'This text request has not been found.',
 '未找到这次账户处理':'This account request has not been found.',
 '登录名需为 3–20 位字母、数字、下划线或短横线。':'Use 3–20 letters, numbers, underscores, or hyphens for your username.',
 '两次填写的新密码不一致。':'The new passwords do not match.',
 '请使用与当前密码不同的新密码。':'Choose a password different from your current one.',
};
