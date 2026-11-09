import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { extractText, isDocumentMime } from '../../common/storage/extract-text';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';

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
  private readonly preflightRate=new RateLimitService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  hasAttachments(messages: InputMessage[]) {
    return messages.some((m) => (m.attachments?.length ?? 0) > 0);
  }
  async preflight(userId:string,ids:string[]){
    if(!this.preflightRate.tryConsume('attachments:'+userId,30))throw new BusinessException(ErrorCode.RATE_LIMITED,'附件核对过于频繁，请稍后再试',429);
    const result=await this.storage.checkAttachments(userId,ids);
    return{items:await Promise.all(result.items.map(async item=>{
      if(item.status!=='available'||!item.file||!isDocumentMime(item.file.mime))return item;
      const row=await this.prisma.uploadFile.findFirst({where:{id:item.id,userId}});if(!row)return{id:item.id,status:'unavailable'};
      try{const text=await this.documentText(row,userId);return text===null?{id:item.id,status:'unavailable',reason:'unreadable'}:item;}
      catch(error){return{id:item.id,status:(error as any)?.getStatus?.()===400||(error as any)?.getStatus?.()===404?'unavailable':'unknown'};}
    }))};
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

      const rows = await this.prisma.uploadFile.findMany({ where: { id: { in: ids }, userId } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const isLast = i === lastUserIdx;

      const blocks: string[] = [];
      const images: string[] = [];
      const metas: AttachmentMeta[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if(!row||row.deletedAt||row.purgedAt||row.expiresAt&&row.expiresAt<=new Date()||row.scope==='app-icon'){
          if(isLast)throw new BusinessException(ErrorCode.ATTACHMENT_UNAVAILABLE,'附件已不可用，请恢复文件或从编辑区移除后再发送',400);
          blocks.push('【较早的附件已不可用，本轮未重新发送】');continue;
        }
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

        let text:string|null;
        try{text=await this.documentText(row,userId);}catch(error){if(!isLast&&[400,404].includes((error as any)?.getStatus?.())){blocks.push('【较早的附件已不可用，本轮未重新发送】');continue;}throw error;}
        if (text === null) {
          if(isLast)throw new BusinessException(ErrorCode.ATTACHMENT_READ_FAILED,'附件内容暂不能读取，请更换文件或从编辑区移除',400);
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
    const current=await this.prisma.uploadFile.findFirst({where:{id:row.id,userId,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{id:true}});
    if(!current)throw new BusinessException(ErrorCode.ATTACHMENT_UNAVAILABLE,'附件已不可用，请恢复文件或从编辑区移除后再发送',400);
    if (row.extractedText !== null) {
      const check=(await this.storage.checkAttachments(userId,[row.id])).items[0];
      if(check?.status==='unavailable')throw new BusinessException(ErrorCode.ATTACHMENT_UNAVAILABLE,'附件已不可用，请恢复文件或从编辑区移除后再发送',400);
      if(check?.status!=='available')throw new BusinessException(ErrorCode.ATTACHMENT_CHECK_FAILED,'文件暂未核对，请稍后重试。',503);
      return row.extractedText;
    }
    if (row.extractError) return null;
    const file=await this.storage.read(row.id,userId,'USER');
    try {
      const text = await extractText(file.buffer, row.mime);
      const updated=await this.prisma.uploadFile.updateMany({where:{id:row.id,userId,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},data:{extractedText:text}});
      if(!updated.count)throw new BusinessException(ErrorCode.ATTACHMENT_UNAVAILABLE,'附件已不可用，请恢复文件或从编辑区移除后再发送',400);
      return text;
    } catch (err: any) {
      if(err?.bizCode===ErrorCode.ATTACHMENT_UNAVAILABLE)throw err;
      const reason = String(err?.message ?? err).slice(0, 200);
      this.logger.warn(`附件解析失败 ${row.id}（${row.filename}）: ${reason}`);
      await this.prisma.uploadFile
        .updateMany({ where: { id: row.id,userId,deletedAt:null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}] }, data: { extractError: reason } })
        .catch(() => void 0);
      (row as any).extractError = reason;
      return null;
    }
  }
}
