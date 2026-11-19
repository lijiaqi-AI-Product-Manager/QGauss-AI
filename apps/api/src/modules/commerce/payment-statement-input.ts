import { createHash } from 'node:crypto';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

export const STATEMENT_MAX_BYTES = 1024 * 1024;
export const STATEMENT_MAX_ROWS = 3000;
export const STATEMENT_MAX_SITE_ONLY = 4000;
const MAX_CENTS = 2_147_483_647;
const DAY_MS = 86_400_000;
const BEIJING_OFFSET = 8 * 3_600_000;
const COLUMNS = ['记录类型', '渠道流水号', '订单号', '交易号', '发生时间', '金额（分）', '手续费（分）'] as const;
type StatementColumn = typeof COLUMNS[number];

export interface StatementInputRow {
  sourceLine: number;
  kind: 'payment' | 'refund';
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

function invalid(message: string): never {
  throw new BusinessException(ErrorCode.PARAM_INVALID, message, 400);
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

function csvCells(text: string, line: number): string[] {
  const cells: string[] = [];
  let offset = 0;
  while (offset <= text.length) {
    let value = '';
    if (text[offset] === '"') {
      offset++;
      let closed = false;
      while (offset < text.length) {
        const char = text[offset++];
        if (char !== '"') value += char;
        else if (text[offset] === '"') {
          value += '"';
          offset++;
        } else {
          closed = true;
          break;
        }
      }
      if (!closed || (offset < text.length && text[offset] !== ',')) invalid('第 ' + line + ' 行引号格式无效');
    } else {
      const end = text.indexOf(',', offset);
      value = text.slice(offset, end === -1 ? text.length : end);
      offset = end === -1 ? text.length : end;
      if (value.includes('"')) invalid('第 ' + line + ' 行引号格式无效');
    }
    cells.push(value.trim());
    if (offset === text.length) break;
    offset++;
  }
  return cells;
}

function reference(value: string, line: number, column: string, max: number): string {
  if (!value) return '';
  const text = /^'\d{15,}$/.test(value) ? value.slice(1) : value;
  if (text.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(text)) {
    invalid('第 ' + line + ' 行的' + column + '格式无效');
  }
  return text;
}

function cents(value: string, line: number, fee: boolean): number {
  const rules = fee ? /^-?\d{1,10}$/ : /^\d{1,10}$/;
  const number = Number(value);
  if (!rules.test(value) || Math.abs(number) > MAX_CENTS || (!fee && number < 1)) {
    invalid('第 ' + line + ' 行的' + (fee ? '手续费' : '金额') + '须使用整数分');
  }
  return number;
}

export function paymentStatementInput(bytes: Buffer, input: Record<string, unknown>) {
  const provider = input.provider;
  if (provider !== 'epay' && provider !== 'hupi') invalid('请选择账单所属的收款通道');
  const period = statementPeriod(input.fromDay, input.throughDay);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > STATEMENT_MAX_BYTES) {
    invalid('请选择不超过 1 MB 的 UTF-8 CSV 账单');
  }

  let csv: string;
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    invalid('账单编码无法读取，请保存为 CSV UTF-8 后重试');
  }

  const physicalLines = csv.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const header = csvCells(physicalLines[0], 1);
  if (header.length !== COLUMNS.length || !COLUMNS.every(column => header.includes(column))) {
    invalid('账单表头与模板不一致，请下载并填写标准模板');
  }
  const positions = new Map(COLUMNS.map(column => [column, header.indexOf(column)]));
  const rows: StatementInputRow[] = [];
  const uniqueEvents = new Set<string>();
  for (let i = 1; i < physicalLines.length; i++) {
    if (!physicalLines[i].trim()) continue;
    const sourceLine = i + 1;
    if (rows.length >= STATEMENT_MAX_ROWS) invalid('每份账单最多 3000 条记录，请分批导入');
    const cells = csvCells(physicalLines[i], sourceLine);
    if (cells.length !== COLUMNS.length) invalid('第 ' + sourceLine + ' 行的列数与表头不一致');
    const value = (key: StatementColumn) => cells[positions.get(key)!];

    const type = value('记录类型');
    if (type !== '收款' && type !== '退款') invalid('第 ' + sourceLine + ' 行的记录类型应为收款或退款');
    const kind = type === '收款' ? 'payment' : 'refund';
    const eventRef = reference(value('渠道流水号'), sourceLine, '渠道流水号', 128);
    const orderRef = reference(value('订单号'), sourceLine, '订单号', 64);
    const tradeRef = reference(value('交易号'), sourceLine, '交易号', 128);
    if (!eventRef || (!orderRef && !tradeRef)) invalid('第 ' + sourceLine + ' 行需填写渠道流水号及订单号或交易号');
    const event = kind + ':' + eventRef;
    if (uniqueEvents.has(event)) invalid('第 ' + sourceLine + ' 行的渠道流水号重复，请核对账单后重新导入');
    uniqueEvents.add(event);

    const occurredAt = parseBeijingTime(value('发生时间'));
    if (!occurredAt) invalid('第 ' + sourceLine + ' 行的发生时间须使用北京时间 YYYY-MM-DD HH:mm:ss');
    if (period && (occurredAt < period.start || occurredAt >= period.end)) invalid('第 ' + sourceLine + ' 行的发生时间超出完整账期');
    const amountCents = cents(value('金额（分）'), sourceLine, false);
    const fee = value('手续费（分）');
    rows.push({ sourceLine, kind, eventRef, orderRef, tradeRef, occurredAt, amountCents,
      feeCents: fee === '' ? null : cents(fee, sourceLine, true) });
  }
  if (!rows.length && !period) invalid('账单没有交易记录。完整零交易账单需要填写账期');
  const normalized = rows.map(({ sourceLine, ...value }) => JSON.stringify(value)).sort();
  const contentHash = createHash('sha256')
    .update(JSON.stringify([period?.fromDay ?? '', period?.throughDay ?? '', normalized]))
    .digest('hex');
  return { provider, period, rows, contentHash };
}
