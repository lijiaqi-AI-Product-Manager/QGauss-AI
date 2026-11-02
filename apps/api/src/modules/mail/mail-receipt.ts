import { isEmail } from 'class-validator';

export const MAIL_STATES = ['queued', 'sending', 'sent', 'failed', 'skipped', 'suppressed', 'unknown'] as const;
export const MAIL_TEMPLATES = ['welcome', 'resetPassword', 'deliveryProbe', 'emailVerification'] as const;
export const RETRYABLE_MAIL_ERRORS = ['SMTP_CONNECT', 'SMTP_TEMPORARY'];

const explanations: Record<string, string> = {
  SMTP_CONNECT: '尚未连接到发件服务器，将按有限次数重新尝试。',
  SMTP_TEMPORARY: '发件服务器暂时拒绝接收，将稍后重新尝试。',
  SMTP_AUTH: '发件账户验证未通过，请由部署负责人核对凭据。',
  SMTP_TLS: '加密连接没有建立，请核对证书与连接方式。',
  SMTP_REJECTED: '发件服务器明确拒绝了这封信，请核对收件与发件设置。',
  RESULT_UNKNOWN: '尚未确认发件服务器是否接受。不会自动重发，请先检查邮箱。',
  LEGACY_UNCERTAIN: '历史记录无法证明是否已被服务器接受，升级后不会自动补发。',
  TRANSPORT_OFF: '发件设置尚未启用，这封信没有发出。',
  CONFIG_INVALID: '发件设置未完整加载，这封信没有发出。',
  RESET_INACTIVE: '重置链接已失效或账户状态已变化，已停止投递。请重新申请找回密码。',
  EMAIL_CODE_INACTIVE: '邮箱验证码已失效或账户状态已变化，已停止投递。请重新寄送验证码。',
  DATA_INVALID: '邮件所需信息不完整，已停止投递。',
};

export function maskedMailbox(value: string) {
  if (typeof value !== 'string' || value.length > 254 || /[\r\n]/.test(value) || !isEmail(value)) return '收件地址已隐藏';
  const index = value.lastIndexOf('@');
  return [...value.slice(0, index)][0] + '***@' + value.slice(index + 1).toLowerCase();
}

export function mailExplanation(error: string | null | undefined, status: string) {
  if (error && Object.hasOwn(explanations, error)) return explanations[error];
  if (status === 'sent') return '发件服务器已接受，不代表一定进入收件箱；请由收件人确认。';
  if (status === 'queued') return '已接受投递请求，等待开始处理。';
  if (status === 'sending') return '正在与发件服务器核对，请稍后刷新状态。';
  if (status === 'skipped') return explanations.TRANSPORT_OFF;
  if (status === 'unknown') return explanations.RESULT_UNKNOWN;
  return '未记录可安全展示的投递说明，请核对发件配置。';
}

export function safeMailReceipt(row: {
  id: string; to: string; template: string; status: string; error?: string | null; attempts: number;
  createdAt: Date; sentAt?: Date | null; lastTriedAt?: Date | null; confirmedAt?: Date | null;
}) {
  const template = (MAIL_TEMPLATES as readonly string[]).includes(row.template) ? row.template : 'unknown';
  const subject = template === 'welcome' ? '欢迎加入 QGauss AI' : template === 'resetPassword' ? 'QGauss AI · 重置密码' : template === 'deliveryProbe' ? 'QGauss AI · 一声你好' : template === 'emailVerification' ? 'QGauss AI · 邮箱验证码' : '历史邮件';
  const status = (MAIL_STATES as readonly string[]).includes(row.status) ? row.status : 'unknown';
  // Deliberately omit stored HTML, payload, raw errors, actor IDs and attempt ownership.
  return { id: row.id, to: maskedMailbox(row.to), subject, template, status, attempts: row.attempts, createdAt: row.createdAt, sentAt: row.sentAt ?? null, lastTriedAt: row.lastTriedAt ?? null, confirmedAt: row.confirmedAt ?? null, explanation: mailExplanation(row.error, status) };
}

/** Only explicit pre-DATA failures or a negative SMTP response may become retryable. */
export function classifyMailFailure(error: unknown): { status: 'failed' | 'unknown'; code: string } {
  const value = error as { code?: unknown; command?: unknown; responseCode?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code.toUpperCase() : '';
  const command = typeof value?.command === 'string' ? value.command.toUpperCase() : '';
  const response = value?.responseCode;
  if (code === 'EAUTH') return { status: 'failed', code: 'SMTP_AUTH' };
  if (['ETLS', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return { status: 'failed', code: 'SMTP_TLS' };
  if (typeof response === 'number' && Number.isInteger(response) && response >= 400 && response <= 599) return { status: 'failed', code: response < 500 ? 'SMTP_TEMPORARY' : 'SMTP_REJECTED' };
  if (/^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)(\b|$)/.test(command)) return { status: 'failed', code: 'SMTP_CONNECT' };
  return { status: 'unknown', code: 'RESULT_UNKNOWN' };
}
