import { createHash } from 'node:crypto';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import {
  csvRecords, decodeStatementCsv, invalidStatement as invalid, mappedStatementRow, standardStatementRow,
  statementFormat, statementMapping, suggestedStatementColumns, wechatStatementRow, wechatSummaryProblem,
  StatementKind, StatementUnit,
} from './payment-statement-csv';

export const STATEMENT_MAX_BYTES = 1024 * 1024;
export const STATEMENT_MAX_ROWS = 3000;
export const STATEMENT_MAX_SITE_ONLY = 4000;
const MAX_CENTS = 2_147_483_647;
const DAY_MS = 86_400_000;
const BEIJING_OFFSET = 8 * 3_600_000;
const PREVIEW_ISSUE_LIMIT = 12;

export interface StatementInputRow {
  sourceLine: number;
  kind: StatementKind;
  eventRef: string;
  orderRef: string;
  tradeRef: string;
  occurredAt: Date;
  amountCents: number;
  feeCents: number | null;
}

export interface StatementPeriod {
  fromDay: string;
  throughDay: string;
  start: Date;
  end: Date;
}

function parseBeijingTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const local = value.replace(' ', 'T');
  const utc = new Date(local + 'Z');
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 19) !== local) return null;
  return new Date(utc.getTime() - BEIJING_OFFSET);
}

function statementPeriod(fromDay: unknown, throughDay: unknown): StatementPeriod | null {
  if ((fromDay === '' || fromDay === undefined) && (throughDay === '' || throughDay === undefined)) return null;
  if (typeof fromDay !== 'string' || typeof throughDay !== 'string') invalid('请选择完整账期的开始和结束日期');
  const start = parseBeijingTime(fromDay + ' 00:00:00');
  const last = parseBeijingTime(throughDay + ' 00:00:00');
  if (!start || !last || last < start) invalid('账期日期无效，请检查开始和结束日期');
  const end = new Date(last.getTime() + DAY_MS);
  if (end.getTime() - start.getTime() > 31 * DAY_MS) invalid('完整账期最多 31 天，请分批导入');
  return { fromDay, throughDay, start, end };
}

function reference(value: string, column: string, max: number): string {
  if (!value) return '';
  const text = /^'\d{15,}$/.test(value) ? value.slice(1) : value;
  if (text.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(text)) {
    invalid(column + '格式无效');
  }
  return text;
}

function cents(value: string, unit: StatementUnit, signed: boolean, fee: boolean): number {
  const parts = (unit === 'cents' ? /^(-?)(\d{1,10})$/ : /^(-?)(\d{1,8})(?:\.(\d{1,2}))?$/).exec(value);
  const digits = parts ? Number(parts[2]) : NaN;
  const absolute = unit === 'cents' ? digits : digits * 100 + Number((parts?.[3] ?? '').padEnd(2, '0'));
  if (!parts || absolute > MAX_CENTS || (!signed && parts[1]) || (!fee && absolute === 0)) {
    const format = unit === 'cents' ? '整数分' : '元（最多两位小数）';
    invalid((fee ? '手续费' : '金额') + '须使用有效的' + format);
  }
  return fee && parts[1] && absolute ? -absolute : absolute;
}

function analyzeStatement(bytes: Buffer, input: Record<string, unknown>) {
  const provider = input.provider;
  if (provider !== 'epay' && provider !== 'hupi') invalid('请选择账单所属的收款通道');
  const period = statementPeriod(input.fromDay, input.throughDay);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > STATEMENT_MAX_BYTES) {
    invalid('请选择不超过 1 MB 的 CSV 账单');
  }

  const source = csvRecords(decodeStatementCsv(bytes));
  let header = source.next().value;
  while (header && !header.problem && header.cells.length === 1 && header.cells[0].startsWith('#')) header = source.next().value;
  if (header?.problem) invalid('第 ' + header.line + ' 行' + header.problem);
  if (!header || header.cells.length < 2 || header.cells.some((cell: string) => cell.length > 120)) {
    invalid('无法读取账单表头，请保留列标题并保存为 CSV');
  }
  const columns: string[] = header.cells;
  const format = statementFormat(columns);
  if (period && format !== 'standard') invalid('只有标准模板支持按完整账期核对缺行');
  const positions = new Map(columns.map((column, index) => [column, index]));
  const mapping = format === 'columns' ? statementMapping(input.columns, columns.length) : null;
  const mappingRequired = format === 'columns' && !mapping;
  const unit = format === 'wechat' ? 'yuan' : mapping?.unit ?? 'cents';
  const rows: StatementInputRow[] = [];
  const excluded = { revoked: 0, unfinishedRefunds: 0 };
  const issues: { line: number | null; message: string }[] = [];
  let issueCount = 0;
  const problem = (line: number | null, message: string) => {
    issueCount++;
    if (issues.length < PREVIEW_ISSUE_LIMIT) issues.push({ line, message });
  };

  if (!mappingRequired) {
    let detailCount = 0;
    const uniqueEvents = new Set<string>();
    for (const record of source) {
      const { line: sourceLine, cells } = record;
      if (format === 'wechat' && cells[0] === '总交易单数' && !record.problem) {
        const message = wechatSummaryProblem(record, source.next().value, detailCount);
        if (message) problem(sourceLine, message);
        const extra = source.next().value;
        if (extra) problem(extra.line, '汇总行后有多余的账单内容');
        break;
      }
      if (++detailCount > STATEMENT_MAX_ROWS) {
        problem(sourceLine, '每份账单最多 3000 条记录，请分批导入');
        break;
      }
      try {
        if (record.problem) invalid(record.problem);
        if (cells.length !== columns.length) invalid('列数与表头不一致');
        const value = (column: string) => cells[positions.get(column) ?? -1] ?? '';
        const row = mapping ? mappedStatementRow(cells, mapping) :
          format === 'wechat' ? wechatStatementRow(value) : standardStatementRow(value);
        if (typeof row === 'string') {
          excluded[row]++;
          continue;
        }
        const { kind } = row;
        const eventRef = reference(row.eventRef, '渠道流水号', 128);
        const orderRef = reference(row.orderRef, '订单号', 64);
        const tradeRef = reference(row.tradeRef, '交易号', 128);
        if (!eventRef || (!orderRef && !tradeRef)) invalid('需填写渠道流水号及订单号或交易号');
        const event = kind + ':' + eventRef;
        if (uniqueEvents.has(event)) invalid('渠道流水号重复，请核对账单后重新导入');
        const occurredAt = parseBeijingTime(row.occurredAt);
        if (!occurredAt) invalid('发生时间须使用北京时间 YYYY-MM-DD HH:mm:ss');
        if (period && (occurredAt < period.start || occurredAt >= period.end)) invalid('发生时间超出完整账期');
        const amountCents = cents(row.amount, unit, Boolean(mapping && kind === 'refund'), false);
        const feeCents = row.fee === '' ? null : cents(row.fee, unit, true, true);
        uniqueEvents.add(event);
        rows.push({ sourceLine, kind, eventRef, orderRef, tradeRef, occurredAt, amountCents, feeCents });
      } catch (error) {
        if (!(error instanceof BusinessException)) throw error;
        problem(sourceLine, error.message);
      }
    }
    if (!issueCount && !rows.length && !period && !excluded.revoked && !excluded.unfinishedRefunds) {
      problem(null, '账单没有交易记录。完整零交易账单需要填写账期');
    }
  }
  const previewToken = !mappingRequired && !issueCount && (rows.length || period) ?
    createHash('sha256').update(JSON.stringify([provider, period?.fromDay, period?.throughDay, mapping]) + '\0').update(bytes).digest('hex') : null;
  return { provider, period, format, columns, rows, mappingRequired, excluded, issues, issueCount, previewToken };
}

export function statementTotals(rows: StatementInputRow[]) {
  let paymentCents = 0;
  let refundCents = 0;
  let feeCents = 0;
  let paymentCount = 0;
  let missingFees = false;
  for (const row of rows) {
    if (row.kind === 'payment') {
      paymentCents += row.amountCents;
      paymentCount++;
    } else {
      refundCents += row.amountCents;
    }
    if (row.feeCents === null) missingFees = true;
    else feeCents += row.feeCents;
  }
  return { paymentCents, refundCents, feeCents: missingFees ? null : feeCents, paymentCount, refundCount: rows.length - paymentCount };
}

export function paymentStatementPreview(bytes: Buffer, fields: Record<string, unknown>) {
  const { format, columns, rows, mappingRequired, excluded, issues, issueCount, previewToken } = analyzeStatement(bytes, fields);
  return {
    format, mappingRequired, columns: format === 'columns' ? columns : [],
    suggested: mappingRequired ? suggestedStatementColumns(columns) : {},
    excluded, issues, issueCount, previewToken, totals: statementTotals(rows), examples: rows.slice(0, 6),
  };
}

export function paymentStatementInput(bytes: Buffer, input: Record<string, unknown>) {
  const { provider, period, rows, format, mappingRequired, issues, previewToken } = analyzeStatement(bytes, input);
  if (mappingRequired) invalid('账单表头与模板不一致，请先预览并选择账单字段');
  if (issues.length) {
    const { line, message } = issues[0];
    invalid(line === null ? message : '第 ' + line + ' 行' + message);
  }
  if (!previewToken) invalid('账单没有可导入的收款或退款记录');
  if ((format !== 'standard' || input.previewToken !== undefined) && input.previewToken !== previewToken) {
    throw new BusinessException(ErrorCode.PARAM_INVALID, '账单或导入设置已变化，请重新预览', 409);
  }
  const normalized = rows.map(({ sourceLine, ...value }) => JSON.stringify(value)).sort();
  const contentHash = createHash('sha256')
    .update(JSON.stringify([period?.fromDay ?? '', period?.throughDay ?? '', normalized]))
    .digest('hex');
  return { provider, period, rows, contentHash };
}
