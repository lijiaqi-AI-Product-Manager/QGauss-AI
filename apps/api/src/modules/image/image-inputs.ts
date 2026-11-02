import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { StorageService } from '../storage/storage.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import type { SourceImage } from './image.provider';

const MAX_PIXELS = 8_388_608, MAX_TOTAL_PIXELS = 25_165_824, MAX_BYTES = 10 * 1024 * 1024, MAX_TOTAL_BYTES = 32 * 1024 * 1024;
interface InputFile { id: string; sha256: string; width: number; height: number }
export interface ImageInputs { version: 1; references: InputFile[]; mask?: InputFile }
const invalid = (message: string): never => { throw new BusinessException(ErrorCode.PARAM_INVALID, message); };
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export function parseImageInputs(raw?: string | null): ImageInputs | null {
  if (!raw) return null;
  const data = JSON.parse(raw);
  const file = (row: any) => row && typeof row.id === 'string' && /^[a-f0-9]{64}$/.test(row.sha256) && Number.isInteger(row.width) && Number.isInteger(row.height) && row.width > 0 && row.height > 0 && row.width * row.height <= MAX_PIXELS;
  if (data.version !== 1 || !Array.isArray(data.references) || !data.references.length || data.references.length > 8 || !data.references.every(file) || (data.mask && !file(data.mask))) return invalid('参考图记录不完整，请重新选择图片');
  return data;
}

/** Read only owned immutable files; validate full decodes before any credit reservation. */
export async function prepareImageInputs(storage: Pick<StorageService, 'read'>, userId: string, ids: string[], maskId?: string, expected?: ImageInputs, normalize = false) {
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) return invalid('请选择 1–8 张不重复的参考图');
  if (maskId && ids.includes(maskId)) return invalid('选区文件不能同时作为参考图');
  const references: InputFile[] = [], images: SourceImage[] = [];
  let bytes = 0, pixels = 0;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    let file: Awaited<ReturnType<StorageService['read']>>;
    try { file = await storage.read(id, userId, 'USER'); } catch { return invalid('参考图不存在或已移除，请重新选择'); }
    bytes += file.buffer.length;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.mime) || file.buffer.length > MAX_BYTES || bytes > MAX_TOTAL_BYTES) return invalid('参考图每张最多 10 MB，合计最多 32 MB');
    const sha256 = hash(file.buffer);
    if (expected && (expected.references[index]?.id !== id || expected.references[index]?.sha256 !== sha256)) return invalid('参考图内容已变化，请重新提交');
    try {
      const options = { limitInputPixels: MAX_PIXELS, failOn: 'warning' as const };
      const metadata = await sharp(file.buffer, options).metadata();
      if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format || '') || (metadata.pages || 1) > 1 || !metadata.width || !metadata.height) return invalid('参考图必须是完整的静态 PNG、JPEG、WebP 或 GIF 图片');
      const rotated = (metadata.orientation || 1) >= 5, width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;
      pixels += width * height;
      if (pixels > MAX_TOTAL_PIXELS) return invalid('参考图合计最多 2400 万像素，请先缩小图片');
      if (normalize) images.push({ buffer: await sharp(file.buffer, options).rotate().png().toBuffer(), mime: 'image/png' });
      else await sharp(file.buffer, options).stats();
      references.push({ id, sha256, width, height });
    } catch (error) { if (error instanceof BusinessException) throw error; return invalid('参考图无法完整解码或超过 800 万像素，请重新保存为较小的静态图片'); }
  }
  let mask: InputFile | undefined, maskImage: SourceImage | undefined;
  if (maskId) {
    let file: Awaited<ReturnType<StorageService['read']>>;
    try { file = await storage.read(maskId, userId, 'USER'); } catch { return invalid('重绘选区不存在或已移除，请重新涂抹'); }
    if (file.mime !== 'image/png' || file.buffer.length > 4 * 1024 * 1024) return invalid('重绘选区必须是不超过 4 MB 的透明 PNG');
    const sha256 = hash(file.buffer);
    if (expected && (expected.mask?.id !== maskId || expected.mask?.sha256 !== sha256)) return invalid('重绘选区已变化，请重新提交');
    try {
      const options = { limitInputPixels: MAX_PIXELS, failOn: 'warning' as const }, metadata = await sharp(file.buffer, options).metadata(), primary = references[0];
      if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.width !== primary.width || metadata.height !== primary.height || (metadata.pages || 1) > 1) return invalid('重绘选区须包含透明通道，并与主图尺寸一致');
      const alpha = await sharp(file.buffer, options).extractChannel('alpha').raw().toBuffer();
      if (!alpha.includes(0) || !alpha.includes(255)) return invalid('请同时保留需要重画的区域和保留区域');
      mask = { id: maskId, sha256, width: primary.width, height: primary.height };
      if (normalize) maskImage = { buffer: await sharp(file.buffer, options).png().toBuffer(), mime: 'image/png' };
    } catch (error) { if (error instanceof BusinessException) throw error; return invalid('重绘选区未能完整解码，请重新涂抹'); }
  }
  return { snapshot: { version: 1 as const, references, ...(mask ? { mask } : {}) }, images, maskImage };
}
