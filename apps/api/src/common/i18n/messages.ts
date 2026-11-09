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

  3001: { zh: '模型不存在', en: 'Model not found' },
  3002: { zh: '暂无可用渠道', en: 'No available channel' },
  3003: { zh: '上游调用失败', en: 'Upstream request failed' },

  4001: { zh: '会话不存在', en: 'Conversation not found' },
  4011: {zh:'附件已不可用，请恢复文件或从编辑区移除后再发送',en:'An attachment is unavailable. Restore it or remove it from the composer before sending.'},
  4012: {zh:'附件内容暂不能读取，请更换文件或从编辑区移除',en:'An attachment could not be read. Replace it or remove it from the composer.'},
  4013: {zh:'文件暂未核对，请稍后重试。',en:'This file could not be checked. Please try again later.'},

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
  return ERROR_MESSAGES[code]?.en ?? fallback;
}
