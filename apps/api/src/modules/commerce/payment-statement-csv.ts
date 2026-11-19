import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

const MAX_COLUMNS = 128;
const SOURCE_TEXT_PREFIX = '\u0060';
const STANDARD_COLUMNS = ['记录类型', '渠道流水号', '订单号', '交易号', '发生时间', '金额（分）', '手续费（分）'] as const;
const WECHAT_COLUMNS = ['交易时间', '微信订单号', '商户订单号', '交易状态', '货币种类', '订单金额', '手续费'] as const;
const statementMappingKeys = ['kind', 'eventRef', 'orderRef', 'tradeRef', 'occurredAt', 'amount', 'fee', 'currency'] as const;
type MappingKey = typeof statementMappingKeys[number];
type ColumnPositions = Partial<Record<MappingKey, number>>;
export type StatementUnit = 'cents' | 'yuan';
export type StatementKind = 'payment' | 'refund';
type RowKind = StatementKind | 'column';
export type Mapping = ColumnPositions & { unit: StatementUnit; rowKind: RowKind };
export type StatementFormat = 'standard' | 'wechat' | 'columns';
export type CsvRecord = { line: number; cells: string[]; problem?: string };

const mappingAliases: Record<MappingKey, string[]> = {
  kind: ['记录类型', '行类型', '业务类型', '交易类型', '交易状态', 'type', 'kind', 'trade_status'],
  eventRef: ['渠道流水号', '流水号', '支付流水号', '退款流水号', '退款单号', 'event_id', 'refund_id'],
  orderRef: ['商户订单号', '订单号', '站内订单号', 'out_trade_no', 'trade_order_id', 'order_id'],
  tradeRef: ['渠道交易号', '网关交易号', '交易号', 'trade_no', 'transaction_id'],
  occurredAt: ['发生时间', '交易时间', '支付时间', '退款时间', '完成时间', 'paid_at', 'occurred_at', 'endtime'],
  amount: ['金额', '交易金额', '收款金额', '退款金额', '金额(元)', '金额(分)', 'money', 'amount', 'amount_cents'],
  fee: ['手续费', '手续费(元)', '手续费(分)', '交易手续费', 'fee', 'fee_cents'],
  currency: ['货币种类', '币种', 'currency', 'currency_code'],
};

export function invalidStatement(message: string): never {
  throw new BusinessException(ErrorCode.PARAM_INVALID, message, 400);
}

export function decodeStatementCsv(bytes: Buffer): string {
  for (const encoding of ['utf-8', 'gb18030']) {
    try {
      const csv = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (!csv.includes('\u0000')) return csv.replace(/^\uFEFF/, '');
    } catch {
      // Try the other supported CSV encoding.
    }
  }
  return invalidStatement('账单编码无法读取，请保存为 CSV UTF-8 后重试');
}

export function* csvRecords(text: string): Generator<CsvRecord> {
  let line = 1;
  let start = line;
  let cells: string[] = [];
  let field = '';
  let quote = 'none';
  let problem: string | undefined;

  function appendCell() {
    if (cells.length < MAX_COLUMNS) cells.push(field.trim());
    else problem ??= '列数超过 128 列';
    field = '';
    quote = 'none';
  }

  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    const newline = char === '\r' || char === '\n';
    if (char === '\r' && text[i + 1] === '\n') i++;
    if (quote === 'open' && char !== undefined) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quote = 'closed';
      } else {
        field += newline ? '\n' : char;
        if (newline) line++;
      }
      continue;
    }
    if (newline || char === undefined) {
      if (quote === 'open') problem ??= '引号格式无效';
      appendCell();
      if (problem || cells.length > 1 || cells[0]) yield { line: start, cells, problem };
      start = ++line;
      cells = [];
      problem = undefined;
    } else if (char === ',') {
      appendCell();
    } else if (quote === 'closed') {
      if (char !== ' ' && char !== '\t') problem ??= '引号格式无效';
    } else if (char === '"' && field === '') {
      quote = 'open';
    } else {
      if (char === '"' && !field.startsWith(SOURCE_TEXT_PREFIX)) problem ??= '引号格式无效';
      field += char;
    }
  }
}

export function statementFormat(columns: string[]): StatementFormat {
  if (columns.length === STANDARD_COLUMNS.length && STANDARD_COLUMNS.every(column => columns.includes(column))) return 'standard';
  if (new Set(columns).size === columns.length && WECHAT_COLUMNS.every(column => columns.includes(column))) return 'wechat';
  return 'columns';
}

export function suggestedStatementColumns(columns: string[]): ColumnPositions {
  const normalized = columns.map(column => column.normalize('NFKC').toLowerCase());
  const result: ColumnPositions = {};
  for (const key of statementMappingKeys) {
    const matches = normalized.flatMap((name, index) => mappingAliases[key].includes(name) ? [index] : []);
    if (matches.length === 1) result[key] = matches[0];
  }
  return result;
}

export function statementMapping(value: unknown, columnCount: number): Mapping | null {
  if (value === undefined || value === '') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : null;
  } catch {
    invalidStatement('账单字段设置无效，请重新选择');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidStatement('账单字段设置无效，请重新选择');
  const { unit, rowKind } = parsed;
  if (unit !== 'cents' && unit !== 'yuan') invalidStatement('请选择源文件的金额单位');
  if (rowKind !== 'payment' && rowKind !== 'refund' && rowKind !== 'column') invalidStatement('请选择账单记录类型');
  const result: Mapping = { unit, rowKind };
  for (const key of statementMappingKeys) {
    if (key === 'kind' && rowKind !== 'column') continue;
    const index = parsed[key];
    if (index === undefined) continue;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= columnCount) {
      invalidStatement('账单字段超出文件列范围，请重新选择');
    }
    result[key] = index;
  }
  if ((rowKind === 'column' && result.kind === undefined) || result.eventRef === undefined ||
      result.occurredAt === undefined || result.amount === undefined ||
      (result.orderRef === undefined && result.tradeRef === undefined)) {
    invalidStatement('请选择类型、流水号、时间、金额，以及订单号或网关交易号');
  }
  const distinct = statementMappingKeys.filter(key => key !== 'eventRef').map(key => result[key]).filter(index => index !== undefined);
  if ((distinct.includes(result.eventRef) && (result.eventRef !== result.tradeRef || rowKind !== 'payment')) ||
      new Set(distinct).size !== distinct.length) {
    invalidStatement('同一列不能用作不同的账单字段；仅收款文件可共用流水号和网关交易号');
  }
  return result;
}

function sourceValue(value: string | undefined) {
  const text = value ?? '';
  return text.startsWith(SOURCE_TEXT_PREFIX) ? text.slice(1).trim() : text;
}

type SourceRow = {
  kind: StatementKind;
  eventRef: string;
  orderRef: string;
  tradeRef: string;
  occurredAt: string;
  amount: string;
  fee: string;
};

const mappedKinds = new Map<string, StatementKind>([
  ...['收款', '支付', '支付成功', '交易成功', 'payment', 'pay', 'trade_success', 'trade_finished'].map(value => [value, 'payment'] as const),
  ...['退款', '退款成功', 'refund', 'refund_success'].map(value => [value, 'refund'] as const),
]);

export function mappedStatementRow(cells: string[], mapping: Mapping): SourceRow {
  const value = (key: MappingKey) => sourceValue(cells[mapping[key] ?? -1]);
  if (mapping.currency !== undefined && !['CNY', 'RMB', '人民币'].includes(value('currency').toUpperCase())) {
    invalidStatement('该账单仅支持人民币交易');
  }
  const kind = mapping.rowKind === 'column' ? mappedKinds.get(value('kind').toLowerCase()) : mapping.rowKind;
  if (!kind) invalidStatement('记录类型应为收款或退款，请核对选列或源文件');
  return {
    kind, eventRef: value('eventRef'), orderRef: value('orderRef'), tradeRef: value('tradeRef'),
    occurredAt: value('occurredAt'), amount: value('amount'), fee: value('fee'),
  };
}

export function standardStatementRow(value: (column: string) => string): SourceRow {
  const type = value('记录类型');
  if (type !== '收款' && type !== '退款') invalidStatement('记录类型应为收款或退款');
  return {
    kind: type === '收款' ? 'payment' : 'refund',
    eventRef: value('渠道流水号'), orderRef: value('订单号'), tradeRef: value('交易号'),
    occurredAt: value('发生时间'), amount: value('金额（分）'), fee: value('手续费（分）'),
  };
}

export function wechatStatementRow(read: (column: string) => string): SourceRow | 'revoked' | 'unfinishedRefunds' {
  const value = (key: string) => sourceValue(read(key));
  const status = value('交易状态');
  if (value('货币种类') !== 'CNY') invalidStatement('该账单仅支持人民币交易');
  if (status === 'REVOKED') return 'revoked';
  if (status !== 'SUCCESS' && status !== 'REFUND') invalidStatement('交易状态无法识别');
  if (status === 'REFUND') {
    const refund = value('退款状态');
    if (['PROCESSING', 'FAIL', 'CHANGE'].includes(refund)) return 'unfinishedRefunds';
    if (refund !== 'SUCCESS') invalidStatement('退款状态缺失或无法识别');
    const eventRef = value('微信退款单号');
    if (eventRef === '0') invalidStatement('退款流水号无效');
    return {
      kind: 'refund', eventRef, orderRef: value('商户订单号'), tradeRef: '',
      occurredAt: value('退款成功时间') || value('交易时间'), amount: value('申请退款金额'), fee: value('手续费'),
    };
  }
  const eventRef = value('微信订单号');
  if (eventRef === '0') invalidStatement('收款流水号无效');
  return {
    kind: 'payment', eventRef, orderRef: value('商户订单号'), tradeRef: '',
    occurredAt: value('交易时间'), amount: value('订单金额'), fee: value('手续费'),
  };
}

export function wechatSummaryProblem(header: CsvRecord, totals: CsvRecord | undefined, detailCount: number) {
  if (!totals || totals.problem || totals.cells.length !== header.cells.length ||
      totals.cells.some(cell => !/^-?\d+(?:\.\d{1,2})?$/.test(sourceValue(cell))) ||
      Number(sourceValue(totals.cells[0])) !== detailCount) return '账单汇总行不完整或交易笔数与明细不符';
  return '';
}
