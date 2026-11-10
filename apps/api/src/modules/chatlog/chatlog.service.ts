import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { messageBilling } from '../chat/chat-accounting.service';
import { ChatLogQuery, parseChatLogQuery, recordDate } from './chatlog.query';

const MAX_EXPORT = 20_000;
const MAX_EXPORT_TEXT_BYTES = 64 * 1024 * 1024;
const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
const publicSelect = {
  id: true, conversationId: true, parentId: true, role: true, status: true, content: true,
  modelName: true, promptTokens: true, completionTokens: true, usageEstimated: true,
  finishReason: true, errorCode: true, durationMs: true, createdAt: true, updatedAt: true,
  billingState: true, billingPool: true, reservedAmount: true, chargedAmount: true, returnedAmount: true, expiredAmount: true,
  conversation: { select: { id: true, title: true, userId: true, appId: true, agentId: true, deletedAt: true, user: { select: { username: true, email: true } } } },
} satisfies Prisma.MessageSelect;
type PublicMessage = Prisma.MessageGetPayload<{ select: typeof publicSelect }>;
function view(message: PublicMessage) {
  return {
    id: message.id, conversationId: message.conversationId, parentId: message.parentId,
    conversationTitle: message.conversation.title, userId: message.conversation.userId,
    user: message.conversation.user.username, email: message.conversation.user.email,
    kind: message.conversation.agentId ? 'agent' : message.conversation.appId ? 'app' : 'chat',
    conversationDeletedAt: message.conversation.deletedAt,
    role: message.role, status: message.status, modelName: message.modelName, content: message.content,
    promptTokens: message.promptTokens, completionTokens: message.completionTokens, usageEstimated: message.usageEstimated,
    finishReason: message.finishReason, errorCode: message.errorCode, durationMs: message.durationMs,
    createdAt: message.createdAt, updatedAt: message.updatedAt, billing: messageBilling(message),
  };
}
function conditions(q: ChatLogQuery) {
  const clauses = [Prisma.sql`m."deletedAt" IS NULL`];
  if (q.userId) clauses.push(Prisma.sql`c."userId"=${q.userId}`);
  if (q.user) clauses.push(Prisma.sql`(c."userId"=${q.user} OR instr(lower(u."username"),lower(${q.user}))>0 OR instr(lower(u."email"),lower(${q.user}))>0)`);
  if (q.conversationId) clauses.push(Prisma.sql`m."conversationId"=${q.conversationId}`);
  if (q.scope === 'active') clauses.push(Prisma.sql`c."deletedAt" IS NULL`);
  if (q.scope === 'trash') clauses.push(Prisma.sql`c."deletedAt" IS NOT NULL`);
  if (q.kind === 'chat') clauses.push(Prisma.sql`c."appId" IS NULL AND c."agentId" IS NULL`);
  if (q.kind === 'app') clauses.push(Prisma.sql`c."appId" IS NOT NULL AND c."agentId" IS NULL`);
  if (q.kind === 'agent') clauses.push(Prisma.sql`c."agentId" IS NOT NULL`);
  if (q.modelName) clauses.push(Prisma.sql`m."modelName"=${q.modelName}`);
  if (q.status) clauses.push(Prisma.sql`m."status"=${q.status}`);
  if (q.role) clauses.push(Prisma.sql`m."role"=${q.role}`);
  if (q.billingState) clauses.push(Prisma.sql`m."billingState"=${q.billingState}`);
  if (q.keyword) clauses.push(Prisma.sql`instr(lower(m."content"),lower(${q.keyword}))>0`);
  const from = recordDate(q.from, 'from'), to = recordDate(q.to, 'to'), asOf = recordDate(q.asOf, 'asOf');
  const end = to && asOf ? new Date(Math.min(to.getTime(), asOf.getTime())) : to || asOf;
  if (from) clauses.push(Prisma.sql`m."createdAt">=${from}`);
  if (end) clauses.push(Prisma.sql`m."createdAt"<=${end}`);
  return Prisma.join(clauses, ' AND ');
}
const joins = Prisma.sql`FROM "messages" m JOIN "conversations" c ON c."id"=m."conversationId" JOIN "users" u ON u."id"=c."userId"`;
function recordIds(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, q: ChatLogQuery, limit: number, offset = 0, ids?: string[]) {
  return tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m."id" ${joins} WHERE ${conditions(q)} ${ids ? Prisma.sql`AND m."id" IN (${Prisma.join(ids)})` : Prisma.empty} ORDER BY m."createdAt" DESC,m."id" DESC LIMIT ${limit} OFFSET ${offset}`);
}
/** Keep complete text across Excel cells, without splitting a surrogate pair. */
function segments(text: string): string[] {
  if (!text) return [''];
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 30_000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}

@Injectable()
export class ChatLogService {
  private readonly logger = new Logger(ChatLogService.name);
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ChatLogQuery, page = 1, pageSize = 20) {
    const q = parseChatLogQuery(query); q.asOf ||= new Date().toISOString();
    return this.prisma.$transaction(async tx => {
      const points = await recordIds(tx, q, pageSize, (page - 1) * pageSize);
      const counts = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${joins} WHERE ${conditions(q)}`);
      const rows = points.length ? await tx.message.findMany({ where: { id: { in: points.map(row => row.id) } }, orderBy, select: publicSelect }) : [];
      return { items: rows.map(view), total: Number(counts[0].total), page, pageSize, asOf: q.asOf };
    });
  }

  async detail(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BusinessException(ErrorCode.PARAM_INVALID, '记录编号不正确', 400);
    return this.prisma.$transaction(async tx => {
      const message = await tx.message.findFirst({ where: { id, deletedAt: null }, select: { ...publicSelect, reasoning: true } });
      if (!message) throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或已移除', 404);
      const parent = message.parentId ? await tx.message.findFirst({ where: { id: message.parentId, conversationId: message.conversationId, deletedAt: null }, select: publicSelect }) : null;
      const branchWhere: Prisma.MessageWhereInput = { conversationId: message.conversationId, deletedAt: null, role: 'ASSISTANT', parentId: message.role === 'USER' ? message.id : message.parentId || '__no_parent__' };
      const [branches, branchCount] = await Promise.all([
        tx.message.findMany({ where: branchWhere, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100, select: publicSelect }),
        tx.message.count({ where: branchWhere }),
      ]);
      return { ...view(message), reasoning: message.reasoning, parent: parent ? view(parent) : null,
        branches: branches.map(row => ({ id: row.id, status: row.status, modelName: row.modelName, createdAt: row.createdAt, content: row.content.slice(0, 240) })), branchCount };
    });
  }

  async exportToStream(query: ChatLogQuery, res: Response, actorId: string) {
    const q = parseChatLogQuery(query); q.asOf ||= new Date().toISOString();
    const authorized = async () => {
      const user = await this.prisma.user.findFirst({ where: { id: actorId, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
      if (!user) throw new BusinessException(ErrorCode.FORBIDDEN, '当前账号无权导出记录', 403);
    };
    await authorized();
    // Bound membership before headers; new records cannot extend this download.
    const selected = await this.prisma.$transaction(async tx => {
      const ids = await recordIds(tx, q, MAX_EXPORT + 1);
      if (ids.length > MAX_EXPORT) throw new BusinessException(ErrorCode.PARAM_INVALID, '单次最多导出 20000 条，请缩小筛选范围', 400);
      const size = await tx.$queryRaw<{ bytes: bigint | null }[]>(Prisma.sql`SELECT sum(length(CAST(m."content" AS BLOB))+coalesce(length(CAST(m."reasoning" AS BLOB)),0)) AS bytes ${joins} WHERE ${conditions(q)}`);
      if (Number(size[0]?.bytes || 0) > MAX_EXPORT_TEXT_BYTES) throw new BusinessException(ErrorCode.PARAM_INVALID, '记录内容较多，请缩小筛选范围后导出', 400);
      return ids;
    });
    if (res.destroyed) return 0;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="QGauss-records-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false });
    workbook.creator = 'QGauss AI'; workbook.lastModifiedBy = 'QGauss AI';
    // ExcelJS 4 exposes its archive on the writer; stop compression when the response closes.
    const archive = (workbook as unknown as { zip: { abort(): void } }).zip;
    const stopArchive = () => { if (!res.writableFinished) archive.abort(); };
    res.on('close', stopArchive);
    const columns = [
      ['时间', 'createdAt', 24], ['记录编号', 'id', 28], ['用户', 'user', 18], ['邮箱', 'email', 26],
      ['会话', 'title', 24], ['会话编号', 'conversationId', 28], ['会话范围', 'scope', 16], ['类型', 'kind', 12],
      ['角色', 'role', 14], ['状态', 'status', 16], ['模型', 'modelName', 24], ['上条消息', 'parentId', 28],
      ['输入token', 'promptTokens', 14], ['输出token', 'completionTokens', 14], ['用量是否估算', 'estimated', 16],
      ['费用状态', 'billingState', 16], ['额度池', 'pool', 14], ['预留', 'reserved', 12], ['实扣', 'charged', 12],
      ['已返还', 'returned', 12], ['已到期', 'expired', 12], ['结束原因', 'finishReason', 18], ['错误代码', 'errorCode', 18],
      ['耗时毫秒', 'durationMs', 14], ['文本分段', 'segment', 14], ['内容', 'content', 80], ['推理内容', 'reasoning', 80],
    ].map(([header, key, width]) => ({ header: String(header), key: String(key), width: Number(width) }));
    let sheetIndex = 1, sheet = workbook.addWorksheet('聊天记录'), rowsInSheet = 1, exported = 0;
    sheet.columns = columns; sheet.getRow(1).commit();
    const disconnected = () => { if (res.destroyed) throw new Error('下载连接已关闭'); };
    try {
      for (let offset = 0; offset < selected.length; offset += 200) {
        disconnected(); await authorized();
        const ids = selected.slice(offset, offset + 200).map(row => row.id);
        const rows = await this.prisma.$transaction(async tx => {
          const points = await recordIds(tx, q, 200, 0, ids);
          return points.length ? tx.message.findMany({ where: { id: { in: points.map(row => row.id) } }, orderBy, select: { ...publicSelect, reasoning: true } }) : [];
        });
        for (const message of rows) {
          disconnected(); const content = segments(message.content), reasoning = segments(message.reasoning || ''), length = Math.max(content.length, reasoning.length), billing = messageBilling(message);
          for (let index = 0; index < length; index++) {
            disconnected();
            if (rowsInSheet >= 1_048_576) { sheet.commit(); sheet = workbook.addWorksheet(`聊天记录 ${++sheetIndex}`); sheet.columns = columns; sheet.getRow(1).commit(); rowsInSheet = 1; }
            sheet.addRow({ createdAt: message.createdAt.toISOString(), id: message.id, user: message.conversation.user.username, email: message.conversation.user.email,
              title: message.conversation.title, conversationId: message.conversationId, scope: message.conversation.deletedAt ? '回收站' : '使用中', kind: view(message).kind,
              role: message.role, status: message.status, modelName: message.modelName || '', parentId: message.parentId || '',
              promptTokens: message.promptTokens, completionTokens: message.completionTokens, estimated: message.promptTokens === null && message.completionTokens === null ? '' : message.usageEstimated ? '是' : '否',
              billingState: billing?.state || 'LEGACY', pool: billing?.pool || '', reserved: billing?.reserved ?? null, charged: billing?.charged ?? null,
              returned: billing?.returned ?? null, expired: billing?.expired ?? null, finishReason: message.finishReason || '', errorCode: message.errorCode || '',
              durationMs: message.durationMs, segment: `${index + 1}/${length}`, content: content[index] || '', reasoning: reasoning[index] || '',
            }).commit(); rowsInSheet++;
          }
          exported++;
        }
      }
      sheet.commit();
      const notes = workbook.addWorksheet('导出说明');
      notes.addRow(['产品', 'QGauss AI']).commit(); notes.addRow(['查询时间', q.asOf]).commit(); notes.addRow(['筛选条件', JSON.stringify(q)]).commit();
      notes.addRow(['选中记录数', selected.length]).commit(); notes.addRow(['实际导出记录数', exported]).commit();
      notes.addRow(['说明', '按查询时间限定记录范围，状态以导出时为准；期间移除或不再符合筛选条件的记录不导出。长文本逐段保留，分段行重复显示记录编号和费用，请按记录编号去重汇总。空白用量和 LEGACY 费用表示历史未记录。']).commit(); notes.commit();
      disconnected(); await authorized();
      await new Promise<void>((resolve, reject) => {
        const interrupted = () => { if (!res.writableFinished) reject(new Error('下载连接已关闭')); };
        res.once('close', interrupted);
        workbook.commit().then(resolve, reject).finally(() => res.off('close', interrupted));
      });
      this.logger.log(`导出对话记录 ${exported} 条`); return exported;
    } catch (error: unknown) {
      this.logger.error(`导出对话记录中止（已写 ${exported} 条）`);
      archive.abort();
      if (!res.writableEnded) res.destroy();
      throw error;
    } finally { res.off('close', stopArchive); }
  }
}
