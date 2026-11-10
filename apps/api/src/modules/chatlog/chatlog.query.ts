import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

export interface ChatLogQuery {
  userId?: string; user?: string; conversationId?: string; modelName?: string; keyword?: string;
  status?: string; role?: string; billingState?: string; scope?: string; kind?: string;
  from?: string; to?: string; asOf?: string;
}
const RECORD_STATUSES = ['PENDING', 'STREAMING', 'SETTLING', 'COMPLETED', 'FAILED', 'ABORTED'];
const invalid = (message: string): never => { throw new BusinessException(ErrorCode.PARAM_INVALID, message, 400); };
function text(value: unknown, key: string, max = 128): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) return invalid(`${key} 查询条件不正确`);
  return value.trim() || undefined;
}
function choice(value: unknown, key: string, choices: string[], fallback?: string) {
  const parsed = text(value, key);
  if (parsed && !choices.includes(parsed)) return invalid(`${key} 查询条件不正确`);
  return parsed || fallback;
}
export function recordDate(value: string | undefined, key: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return invalid(`${key} 不是合法的时间格式`);
  const date = new Date(value), [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.getTime()) || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || (value.length > 10 && Number(value.slice(11, 13)) > 23)) return invalid(`${key} 不是合法的时间格式`);
  return date;
}
export function parseChatLogQuery(input: ChatLogQuery | Record<string, unknown> = {}): ChatLogQuery {
  const keys = new Set(['userId', 'user', 'conversationId', 'modelName', 'keyword', 'status', 'role', 'billingState', 'scope', 'kind', 'from', 'to', 'asOf', 'page', 'pageSize']);
  if (Object.keys(input).some(key => !keys.has(key))) return invalid('不支持的查询条件');
  const parsed: ChatLogQuery = {
    userId: text(input.userId, 'userId'), user: text(input.user, 'user', 160), conversationId: text(input.conversationId, 'conversationId'),
    modelName: text(input.modelName, 'modelName', 200), keyword: text(input.keyword, 'keyword', 400),
    status: choice(input.status, 'status', RECORD_STATUSES), role: choice(input.role, 'role', ['USER', 'ASSISTANT', 'SYSTEM']),
    billingState: choice(input.billingState, 'billingState', ['LEGACY', 'FREE', 'RESERVED', 'SETTLING', 'SETTLED', 'RELEASED']),
    scope: choice(input.scope, 'scope', ['all', 'active', 'trash'], 'all'), kind: choice(input.kind, 'kind', ['all', 'chat', 'app', 'agent'], 'all'),
    from: text(input.from, 'from', 40), to: text(input.to, 'to', 40), asOf: text(input.asOf, 'asOf', 40),
  };
  const from = recordDate(parsed.from, 'from'), to = recordDate(parsed.to, 'to'), asOf = recordDate(parsed.asOf, 'asOf');
  if (from && to && from > to) return invalid('开始时间不能晚于结束时间');
  if (asOf && asOf.getTime() > Date.now() + 1000) return invalid('查询时间不能晚于当前时间');
  return parsed;
}
export function recordPaging(input: Record<string, unknown>) {
  const integer = (value: unknown, fallback: number, max: number, key: string) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) return invalid(`${key} 必须是有效的正整数`);
    return Number(value);
  };
  return { page: integer(input.page, 1, 1_000_000, 'page'), pageSize: integer(input.pageSize, 20, 200, 'pageSize') };
}
