/**
 * 文档 → 纯文本（对话附件用）
 *
 * 只做「读出文字」：PDF 用 unpdf（pdf.js），Word 用 mammoth，Excel 用 exceljs，文本直接解码。
 * 解析器都是纯 JS，没有原生依赖；整体有超时，坏文件 / 加密 PDF 抛错由调用方记录。
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 缓存进库的上限：超长文档只存前面这一截，注入上下文时还会再按配置截断 */
const STORE_LIMIT = 300_000;
const TIMEOUT_MS = 20_000;

export function isDocumentMime(mime: string) {
  return mime === 'application/pdf' || mime === DOCX || mime === XLSX || mime.startsWith('text/');
}

export async function extractText(buffer: Buffer, mime: string): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('文档解析超时')), TIMEOUT_MS);
  });
  try {
    const text = await Promise.race([parse(buffer, mime), timeout]);
    return normalize(text).slice(0, STORE_LIMIT);
  } finally {
    clearTimeout(timer);
  }
}

async function parse(buffer: Buffer, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    const { getDocumentProxy, extractText: pdfText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
      const { text } = await pdfText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join('\n') : text;
    } finally { await pdf.loadingTask.destroy(); }
  }
  if (mime === DOCX) {
    const module = await import('mammoth');
    const mammoth = module.default ?? module;
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (mime === XLSX) {
    const module = await import('exceljs');
    const ExcelJS = module.default ?? module;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const parts: string[] = [];
    wb.eachSheet((sheet) => {
      parts.push(`# 工作表：${sheet.name}`);
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells = (row.values as unknown[]).slice(1).map(cellText);
        parts.push(cells.join('\t'));
      });
    });
    return parts.join('\n');
  }
  if (mime.startsWith('text/')) return buffer.toString('utf8');
  throw new Error(`不支持解析的类型：${mime}`);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.richText && Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
    if ('result' in o) return String(o.result ?? '');
    if ('text' in o) return String(o.text ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function normalize(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
