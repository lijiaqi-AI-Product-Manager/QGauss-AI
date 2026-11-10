import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { recordDate, recordPaging } from '../chatlog/chatlog.query';

const invalid = (message: string): never => { throw new BusinessException(ErrorCode.PARAM_INVALID, message, 400); };
function text(value: unknown, key: string, max = 160): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) return invalid(`${key} 查询条件不正确`);
  return value.trim() || undefined;
}
export function userId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return invalid('用户编号不正确');
  return value;
}
export function userQuery(input: Record<string, unknown> = {}) {
  const allowed = new Set(['page','pageSize','keyword','username','email','userId','status','role','distribution','adminNote','from','to','asOf']);
  if (Object.keys(input).some(key => !allowed.has(key))) return invalid('不支持的用户查询条件');
  const q = { ...recordPaging(input), keyword:text(input.keyword,'keyword'), username:text(input.username,'username'), email:text(input.email,'email'),
    userId:text(input.userId,'userId',128), status:text(input.status,'status'), role:text(input.role,'role'), distribution:text(input.distribution,'distribution'),adminNote:text(input.adminNote,'adminNote'),
    from:text(input.from,'from',40), to:text(input.to,'to',40), asOf:text(input.asOf,'asOf',40) || new Date().toISOString() };
  if (q.pageSize > 100) return invalid('每页最多 100 位用户');
  if (q.userId) userId(q.userId);
  for (const [value,choices] of [[q.status,['ACTIVE','DISABLED']],[q.role,['USER','ADMIN']],[q.distribution,['true','false']]] as const) if (value && !(choices as readonly string[]).includes(value)) return invalid('用户筛选条件不正确');
  const from=recordDate(q.from,'from'),to=recordDate(q.to,'to'),asOf=recordDate(q.asOf,'asOf')!;
  if (from && to && from > to) return invalid('开始时间不能晚于结束时间');
  if (asOf.getTime() > Date.now()+1000) return invalid('查询时间不能晚于当前时间');
  return q;
}
export function userConditions(q: ReturnType<typeof userQuery>) {
  const parts=[Prisma.sql`u."deletedAt" IS NULL`,Prisma.sql`u."createdAt"<=${new Date(q.asOf)}`];
  if(q.userId)parts.push(Prisma.sql`u."id"=${q.userId}`);
  if(q.keyword)parts.push(Prisma.sql`(u."id"=${q.keyword} OR instr(lower(u."username"),lower(${q.keyword}))>0 OR instr(lower(u."email"),lower(${q.keyword}))>0 OR instr(lower(coalesce(u."displayName",'')),lower(${q.keyword}))>0)`);
  if(q.username)parts.push(Prisma.sql`instr(lower(u."username"),lower(${q.username}))>0`);
  if(q.email)parts.push(Prisma.sql`instr(lower(u."email"),lower(${q.email}))>0`);
  if(q.status)parts.push(Prisma.sql`u."status"=${q.status}`);
  if(q.role)parts.push(Prisma.sql`u."role"=${q.role}`);
  if(q.distribution)parts.push(Prisma.sql`u."isDistribution"=${q.distribution==='true'}`);
  if(q.adminNote)parts.push(Prisma.sql`instr(lower(u."adminNote"),lower(${q.adminNote}))>0`);
  if(q.from)parts.push(Prisma.sql`u."createdAt">=${new Date(q.from)}`);
  if(q.to)parts.push(Prisma.sql`u."createdAt"<=${new Date(q.to)}`);
  return Prisma.join(parts,' AND ');
}
export function activityQuery(input: Record<string, unknown> = {}) {
  if(Object.keys(input).some(key=>!['kind','page','pageSize','asOf'].includes(key)))return invalid('不支持的明细查询条件');
  const kind=text(input.kind,'kind') || 'grants';
  if(!['grants','logins','conversations','management'].includes(kind))return invalid('用户明细类型不正确');
  const paging=recordPaging(input);if(paging.pageSize>50)return invalid('明细每页最多 50 条');
  const asOf=text(input.asOf,'asOf',40)||new Date().toISOString(),point=recordDate(asOf,'asOf')!;
  if(point.getTime()>Date.now()+1000)return invalid('查询时间不能晚于当前时间');
  return {kind,...paging,asOf};
}
