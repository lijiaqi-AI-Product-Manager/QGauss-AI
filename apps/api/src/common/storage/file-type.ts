/**
 * 文件类型识别（魔数嗅探）
 *
 * 只信任文件内容，不信任客户端声明的 Content-Type / 扩展名。
 * 这是上传功能最基本的一道防线：把 .exe 改名成 .png 传上来，魔数会对不上。
 */

export interface DetectedType {
  mime: string;
  ext: string;
}

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.length > 3 && b.subarray(0, 3).toString('ascii') === 'GIF',
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    test: (b) => b.length > 4 && b.subarray(0, 4).toString('ascii') === '%PDF',
  },
  {
    mime: 'audio/mpeg',
    ext: 'mp3',
    test: (b) => b.length > 3 && b.subarray(0, 3).toString('ascii') === 'ID3',
  },
  {
    mime: 'audio/wav',
    ext: 'wav',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
];

/**
 * Office Open XML（docx / xlsx）本质是 zip：先认 zip 魔数，再看包里有没有对应的部件目录。
 * 部件名在 zip 本地头和中央目录里都是明文，不用解压就能判断。
 */
const OOXML: Array<{ mime: string; ext: string; part: string }> = [
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    part: 'word/document.xml',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    part: 'xl/workbook.xml',
  },
];

function detectOoxml(buf: Buffer): DetectedType | null {
  if (buf.length < 30 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) return null;
  for (const t of OOXML) {
    if (buf.indexOf(t.part, 0, 'latin1') !== -1) return { mime: t.mime, ext: t.ext };
  }
  return null;
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  // 含 NUL 字节的几乎一定是二进制
  for (let i = 0; i < Math.min(buf.length, 1024); i += 1) {
    if (buf[i] === 0) return false;
  }
  const decoded = buf.subarray(0, 1024).toString('utf8');
  return !decoded.includes('\uFFFD');
}

export function detectType(buf: Buffer): DetectedType | null {
  for (const sig of SIGNATURES) {
    if (sig.test(buf)) return { mime: sig.mime, ext: sig.ext };
  }
  const office = detectOoxml(buf);
  if (office) return office;
  if (looksLikeText(buf)) return { mime: 'text/plain', ext: 'txt' };
  return null;
}
