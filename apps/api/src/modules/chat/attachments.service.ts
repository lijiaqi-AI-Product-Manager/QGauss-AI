import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { extractText, isDocumentMime } from '../../common/storage/extract-text';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';

export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'document';
}

/** 进入上游前的消息：content 已经并入文档文本，images 只有本轮用户消息才有 */
export interface ResolvedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface InputMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: string[];
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * 对话附件：把消息里引用的文件 id 解析成上游能吃的内容。
 *
 *   - 文档（PDF / Word / Excel / 文本）：首次引用时提取文本并缓存进 upload_files，
 *     以「【附件：文件名】…」块放在用户原话之前（上下文截断保留尾部，用户的问题不会被截掉）
 *   - 图片：只有最后一条用户消息里的图片以 data URL 发给识图模型；
 *     更早轮次的图片换成文字占位，避免每轮都重复上传大图
 *   - 只能引用自己的文件；数量和单文档长度受后台配置约束
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  hasAttachments(messages: InputMessage[]) {
    return messages.some((m) => (m.attachments?.length ?? 0) > 0);
  }

  async resolve(
    userId: string,
    messages: InputMessage[],
    opts: { vision: boolean },
  ): Promise<{ messages: ResolvedMessage[]; lastUserAttachments: AttachmentMeta[] }> {
    const maxCount = Number(await this.settings.get<number>('chat.maxAttachments')) || 9;
    const maxChars = Number(await this.settings.get<number>('chat.attachmentMaxChars')) || 20000;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');

    const out: ResolvedMessage[] = [];
    let lastUserAttachments: AttachmentMeta[] = [];

    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      const ids = [...new Set(m.attachments ?? [])];
      if (m.role !== 'user' || ids.length === 0) {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      if (ids.length > maxCount) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, `单条消息最多附带 ${maxCount} 个文件`);
      }

      const rows = await this.prisma.uploadFile.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
      if (rows.length !== ids.length) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '附件不存在或已删除', 400);
      }
      const byId = new Map(rows.map((r) => [r.id, r]));
      const isLast = i === lastUserIdx;

      const blocks: string[] = [];
      const images: string[] = [];
      const metas: AttachmentMeta[] = [];
      for (const id of ids) {
        const row = byId.get(id)!;
        const isImage = IMAGE_MIMES.has(row.mime);
        if (!isImage && !isDocumentMime(row.mime)) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, `「${row.filename}」不能作为对话附件`, 400);
        }
        metas.push({ id, name: row.filename, mime: row.mime, size: row.size, kind: isImage ? 'image' : 'document' });

        if (isImage) {
          if (!isLast) {
            blocks.push(`【图片：${row.filename}（较早上传，本轮未重新发送）】`);
            continue;
          }
          if (!opts.vision) {
            throw new BusinessException(
              ErrorCode.PARAM_INVALID,
              '当前模型不支持识图，请切换到支持图片理解的模型后再发送图片',
              400,
            );
          }
          const file = await this.storage.read(id, userId, 'USER');
          images.push(`data:${row.mime};base64,${file.buffer.toString('base64')}`);
          continue;
        }

        const text = await this.documentText(row, userId);
        if (text === null) {
          blocks.push(`【附件：${row.filename}】（无法读取文件内容：${row.extractError ?? '解析失败'}）`);
          continue;
        }
        const clipped = text.length > maxChars;
        blocks.push(
          `【附件：${row.filename}】\n${clipped ? text.slice(0, maxChars) : text}` +
            (clipped ? `\n（文档过长，仅提供前 ${maxChars} 字）` : '') +
            `\n【附件结束】`,
        );
      }

      if (isLast) lastUserAttachments = metas;
      out.push({
        role: 'user',
        content: blocks.length ? `${blocks.join('\n\n')}\n\n${m.content}` : m.content,
        ...(images.length ? { images } : {}),
      });
    }

    return { messages: out, lastUserAttachments };
  }

  /** 已缓存直接用；否则解析并回写缓存。失败也落库，避免每轮重试同一个坏文件 */
  private async documentText(
    row: { id: string; mime: string; filename: string; extractedText: string | null; extractError: string | null },
    userId: string,
  ): Promise<string | null> {
    if (row.extractedText !== null) return row.extractedText;
    if (row.extractError) return null;
    try {
      const file = await this.storage.read(row.id, userId, 'USER');
      const text = await extractText(file.buffer, row.mime);
      await this.prisma.uploadFile.update({ where: { id: row.id }, data: { extractedText: text } });
      return text;
    } catch (err: any) {
      const reason = String(err?.message ?? err).slice(0, 200);
      this.logger.warn(`附件解析失败 ${row.id}（${row.filename}）: ${reason}`);
      await this.prisma.uploadFile
        .update({ where: { id: row.id }, data: { extractError: reason } })
        .catch(() => void 0);
      (row as any).extractError = reason;
      return null;
    }
  }
}
