import { Injectable } from '@nestjs/common';
import { PaymentStatementRow, Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { toInt } from '../../common/params';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ORDER_STATUS } from './order.service';
import { paymentStatementInput, StatementInputRow, STATEMENT_MAX_SITE_ONLY } from './payment-statement-input';
import { findingLabels, reconcileStatementRows, statementOrderSelect } from './payment-statement-match';

const summaryInclude = {
  _count: { select: { rows: { where: { state: 'open' } } } },
} satisfies Prisma.PaymentStatementInclude;
const recentDecisions = {
  decisions: { orderBy: { revision: 'desc' as const }, take: 4 },
} satisfies Prisma.PaymentStatementRowInclude;

function statementSummary(statement: Prisma.PaymentStatementGetPayload<{ include: typeof summaryInclude }>) {
  const { id, provider, fileName, fromDay, throughDay, paymentCents, refundCents, feeCents,
    importedCount, matchedCount, missingCount, createdAt, _count } = statement;
  const rowCount = importedCount + missingCount;
  return {
    id, provider, fileName, fromDay, throughDay, importedCount, matchedCount, missingCount, rowCount, createdAt,
    paymentCents: Number(paymentCents), refundCents: Number(refundCents), feeCents: feeCents === null ? null : Number(feeCents),
    openCount: _count.rows, reviewedCount: rowCount - matchedCount - _count.rows,
  };
}

function statementRow(row: PaymentStatementRow & { decisions?: { revision: number; state: string; note: string; actorId: string; createdAt: Date }[] }) {
  const { statementId, findingCodes, ...publicRow } = row;
  const codes = JSON.parse(findingCodes) as (keyof typeof findingLabels)[];
  return { ...publicRow, findings: codes.map(code => findingLabels[code] ?? code) };
}

function pagination(query: Record<string, unknown>, limit: number) {
  const page = toInt(query.page, 1, 1, 1_000_000, '页码');
  const take = toInt(query.pageSize, 20, 1, limit, '每页条数');
  return { page, skip: (page - 1) * take, take };
}

function notFound() {
  return new BusinessException(ErrorCode.NOT_FOUND, '账单或该笔记录不存在', 404);
}

@Injectable()
export class PaymentStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async importStatement(actorId: string, fileName: string, bytes: Buffer, fields: Record<string, unknown>) {
    const parsed = paymentStatementInput(bytes, fields);
    const { provider, period, rows, contentHash } = parsed;
    const where = { provider_contentHash: { provider, contentHash } };
    const exact = () => this.prisma.paymentStatement.findUnique({ where, include: summaryInclude });
    const original = await exact();
    if (original) return { ...statementSummary(original), reused: true };
    const label = fileName.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 160) || '渠道账单.csv';

    try {
      return await this.prisma.$transaction(async tx => {
        const previous = await tx.paymentStatement.findUnique({ where, include: summaryInclude });
        if (previous) return { ...statementSummary(previous), reused: true };

        const covered = period ? await tx.order.findMany({
          where: { payPlatform: provider, paydAt: { gte: period.start, lt: period.end }, status: { in: [ORDER_STATUS.PAID, ORDER_STATUS.REFUNDED] } },
          orderBy: [{ paydAt: 'asc' }, { orderId: 'asc' }],
          select: statementOrderSelect,
          take: STATEMENT_MAX_SITE_ONLY + 1,
        }) : [];
        if (covered.length > STATEMENT_MAX_SITE_ONLY) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, '账期内站内订单超过 4000 笔，请按较短账期分批导入', 400);
        }
        const found = await this.findOrders(tx, provider, rows);
        const reconciled = reconcileStatementRows(rows, found, covered, provider);
        let paymentCents = 0;
        let refundCents = 0;
        let feeCents = 0;
        let missingFees = false;
        for (const row of rows) {
          if (row.kind === 'payment') paymentCents += row.amountCents;
          else refundCents += row.amountCents;
          if (row.feeCents === null) missingFees = true;
          else feeCents += row.feeCents;
        }
        const batch = await tx.paymentStatement.create({
          data: {
            provider, contentHash, fileName: label, importedBy: actorId,
            fromDay: period?.fromDay, throughDay: period?.throughDay,
            paymentCents: BigInt(paymentCents), refundCents: BigInt(refundCents), feeCents: missingFees ? null : BigInt(feeCents),
            importedCount: rows.length, missingCount: reconciled.length - rows.length,
            matchedCount: reconciled.filter(row => row.findings.length === 0).length,
          },
          select: { id: true },
        });

        for (let start = 0; start < reconciled.length; start += 250) {
          await tx.paymentStatementRow.createMany({
            data: reconciled.slice(start, start + 250).map(({ findings, ...row }, index) => ({
              ...row, statementId: batch.id, ordinal: start + index + 1,
              state: findings.length ? 'open' : 'matched', findingCodes: JSON.stringify(findings),
            })),
          });
        }
        const result = await tx.paymentStatement.findUniqueOrThrow({ where: { id: batch.id }, include: summaryInclude });
        return { ...statementSummary(result), reused: false };
      }, { timeout: 15_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await exact();
        if (previous) return { ...statementSummary(previous), reused: true };
      }
      throw error;
    }
  }

  async list(query: Record<string, unknown>) {
    const { skip, take, page } = pagination(query, 50);
    const [statements, total] = await this.prisma.$transaction([
      this.prisma.paymentStatement.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take, include: summaryInclude,
      }),
      this.prisma.paymentStatement.count(),
    ]);
    return { items: statements.map(statementSummary), total, page, pageSize: take };
  }

  async detail(id: string, query: Record<string, unknown>, exportAll = false) {
    const { skip, take, page } = pagination(query, 100);
    const state = query.state;
    if (state !== undefined && state !== '' && state !== 'open' && state !== 'reviewed' && state !== 'matched') {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '账单记录筛选无效', 400);
    }
    const where: Prisma.PaymentStatementRowWhereInput = { statementId: id };
    if (state) where.state = String(state);
    const [statement, entries, total] = await this.prisma.$transaction([
      this.prisma.paymentStatement.findUnique({ where: { id }, include: summaryInclude }),
      this.prisma.paymentStatementRow.findMany({
        where, orderBy: { ordinal: 'asc' }, ...(exportAll ? {} : { skip, take }),
        include: exportAll ? { decisions: { orderBy: { revision: 'desc' }, take: 1 } } : recentDecisions,
      }),
      this.prisma.paymentStatementRow.count({ where }),
    ]);
    if (!statement) throw notFound();
    return { statement: statementSummary(statement), items: entries.map(statementRow), total, page, pageSize: take };
  }

  async decide(statementId: string, rowId: string, actorId: string, fields: Record<string, unknown>) {
    const { state } = fields;
    const note = typeof fields.note === 'string' ? fields.note.trim() : '';
    if (state !== 'open' && state !== 'reviewed') {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择登记复核或重新打开', 400);
    }
    if (!note || note.length > 500) throw new BusinessException(ErrorCode.PARAM_INVALID, '请填写 1–500 字的复核说明', 400);
    const expected = toInt(fields.revision, -1, 0, 2_147_483_646, '记录版本');
    if (expected < 0) throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少账单记录版本', 400);
    const where = { id: rowId, statementId };
    return this.prisma.$transaction(async tx => {
      const row = await tx.paymentStatementRow.findFirst({ where, include: recentDecisions });
      if (!row) throw notFound();
      const latest = row.decisions[0];
      if (row.revision === expected + 1 && row.state === state && latest?.actorId === actorId && latest.note === note) {
        return statementRow(row);
      }
      if (row.state === 'matched' || row.state === state || row.revision !== expected) {
        throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '核对状态已变化，请刷新后重试', 409);
      }

      const updated = await tx.paymentStatementRow.updateMany({
        where: { ...where, revision: expected }, data: { state, revision: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new BusinessException(ErrorCode.ORDER_STATE_INVALID, '核对状态已变化，请刷新后重试', 409);
      }
      await tx.paymentStatementDecision.create({ data: { rowId, actorId, note, state, revision: expected + 1 } });
      return statementRow(await tx.paymentStatementRow.findUniqueOrThrow({ where: { id: rowId }, include: recentDecisions }));
    });
  }

  private async findOrders(tx: Prisma.TransactionClient, provider: string, rows: StatementInputRow[]) {
    const orderRefs = [...new Set(rows.map(row => row.orderRef).filter(Boolean))];
    const tradeRefs = [...new Set(rows.map(row => row.tradeRef).filter(Boolean))];
    const matches = new Map<string, Prisma.OrderGetPayload<{ select: typeof statementOrderSelect }>>();
    const length = Math.max(orderRefs.length, tradeRefs.length);
    for (let start = 0; start < length; start += 200) {
      const orders = await tx.order.findMany({
        where: { OR: [
          { orderId: { in: orderRefs.slice(start, start + 200) } },
          { payPlatform: provider, tradeId: { in: tradeRefs.slice(start, start + 200) } },
        ] },
        select: statementOrderSelect,
      });
      for (const order of orders) matches.set(order.orderId, order);
    }
    return [...matches.values()];
  }
}
