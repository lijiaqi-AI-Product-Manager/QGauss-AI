import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

export interface ChatLogQuery {
  userId?: string;
  modelName?: string;
  status?: string;
  keyword?: string;
  from?: string;
  to?: string;
}

function toDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BusinessException(ErrorCode.PARAM_INVALID, `${label} 不是合法的时间格式`, 400);
  }
  return d;
}

function buildWhere(q: ChatLogQuery) {
  const where: any = { deletedAt: null };

  if (q.userId) where.conversation = { userId: q.userId };
  if (q.modelName) where.modelName = q.modelName;
  if (q.status) where.status = q.status;
  if (q.keyword) where.content = { contains: q.keyword };

  // 非法日期直接 400，别把 Invalid Date 丢给 Prisma（会变成 500）
  const from = toDate(q.from, 'from');
  const to = toDate(q.to, 'to');
  if (from || to) {
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  return where;
}

@Injectable()
export class ChatLogService {
  private readonly logger = new Logger(ChatLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(q: ChatLogQuery, page = 1, pageSize = 20) {
    const where = buildWhere(q);
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          conversation: {
            select: { id: true, title: true, userId: true, user: { select: { username: true, email: true } } },
          },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      items: rows.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        conversationTitle: m.conversation?.title,
        user: m.conversation?.user?.username,
        email: m.conversation?.user?.email,
        role: m.role,
        status: m.status,
        modelName: m.modelName,
        content: m.content,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        finishReason: m.finishReason,
        errorCode: m.errorCode,
        createdAt: m.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 流式导出 Excel。
   * 用 WorkbookWriter 直接写响应流，避免几万条记录把内存撑爆；
   * 分批用游标（id 递增）翻页，不用 skip —— skip 在深分页会越来越慢。
   */
  async exportToStream(q: ChatLogQuery, res: Response) {
    // 先算好查询条件（含日期校验）：一旦开始流式写，再抛错客户端只会拿到半截坏文件
    const where = buildWhere(q);

    const fileName = `chat-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false });
    const sheet = workbook.addWorksheet('聊天记录');

    sheet.columns = [
      { header: '时间', key: 'createdAt', width: 20 },
      { header: '用户', key: 'user', width: 18 },
      { header: '邮箱', key: 'email', width: 26 },
      { header: '会话', key: 'title', width: 24 },
      { header: '角色', key: 'role', width: 10 },
      { header: '状态', key: 'status', width: 12 },
      { header: '模型', key: 'modelName', width: 20 },
      { header: '输入token', key: 'promptTokens', width: 12 },
      { header: '输出token', key: 'completionTokens', width: 12 },
      { header: '结束原因', key: 'finishReason', width: 14 },
      { header: '内容', key: 'content', width: 80 },
    ];
    sheet.getRow(1).commit();

    const BATCH = 500;
    let cursor: string | undefined;
    let exported = 0;

    try {
      while (true) {
        const rows = await this.prisma.message.findMany({
          where,
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: {
            conversation: {
              select: { title: true, user: { select: { username: true, email: true } } },
            },
          },
        });
        if (rows.length === 0) break;

        for (const m of rows) {
          sheet
            .addRow({
              createdAt: m.createdAt.toISOString(),
              user: m.conversation?.user?.username ?? '',
              email: m.conversation?.user?.email ?? '',
              title: m.conversation?.title ?? '',
              role: m.role,
              status: m.status,
              modelName: m.modelName ?? '',
              promptTokens: m.promptTokens ?? 0,
              completionTokens: m.completionTokens ?? 0,
              finishReason: m.finishReason ?? '',
              content: (m.content ?? '').slice(0, 32000),
            })
            .commit();
          exported += 1;
        }

        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH) break;
      }

      sheet.commit();
      await workbook.commit();
      this.logger.log(`导出聊天记录 ${exported} 条`);
      return exported;
    } catch (err: any) {
      this.logger.error(`导出聊天记录失败（已写 ${exported} 条）: ${err?.message}`, err?.stack);
      // 响应头早已发出，改不了状态码：直接断开连接，让客户端明确感知失败，
      // 而不是拿到一个看起来正常、实际缺行的 xlsx
      if (!res.writableEnded) {
        res.destroy(err instanceof Error ? err : new Error('导出失败'));
      }
      throw err;
    }
  }
}
