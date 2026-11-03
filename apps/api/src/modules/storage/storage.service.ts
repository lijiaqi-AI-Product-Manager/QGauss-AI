import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { buffer as streamBuffer } from 'node:stream/consumers';
import { join } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { StorageDriver } from '../../common/storage/storage.driver';
import { createStorageDriver } from '../../common/storage/s3.driver';
import { detectType } from '../../common/storage/file-type';
import { SettingsService } from '../settings/settings.service';

export interface IncomingFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * multer（busboy）按 latin1 解 multipart 里的文件名，中文名会变成「è¯´æ」这样的乱码。
 * 只在「全是单字节字符、且按 UTF-8 重解后合法」时还原，避免误伤本来就正确的名字。
 */
export function decodeFilename(name: string | undefined) {
  if (!name || !/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  /** 就绪探针缓存：60 秒内复用，避免探活把存储打成热点 */
  private probeCache?: { at: number; value: { driver: string; ok: boolean; error?: string } };
  /** 下载链接要跟 API_PREFIX 保持一致，否则改前缀后前端拿到的是死链 */
  private readonly prefix = (process.env.API_PREFIX ?? 'api').replace(/^\/+|\/+$/g, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {
    // 驱动由环境变量决定（local / s3）；配置写错就在启动时抛，不静默退回本地盘
    this.driver = createStorageDriver();
    this.logger.log(`storage driver=${this.driver.name}`);
  }

  async upload(userId: string, file: IncomingFile, scope = 'chat') {
    if (scope === 'app-icon') throw new BusinessException(ErrorCode.PARAM_INVALID, '请从应用编辑页添加图片形象', 400);
    if (!file || !file.buffer?.length) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '没有收到文件');
    }

    const maxMb = await this.settings.get<number>('upload.maxSizeMb');
    if (file.size > maxMb * 1024 * 1024) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, `文件超过 ${maxMb}MB 限制`, 413);
    }

    // 只信内容，不信声明
    const detected = detectType(file.buffer);
    if (!detected) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '无法识别的文件类型');
    }

    const allowed = (await this.settings.get<string>('upload.allowedMime'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(detected.mime)) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `不支持的文件类型：${detected.mime}`,
        415,
      );
    }

    if (file.mimetype && file.mimetype !== detected.mime && file.mimetype !== 'application/octet-stream') {
      this.logger.warn(
        `文件类型声明与内容不一致（声明 ${file.mimetype} / 实际 ${detected.mime}），以实际为准`,
      );
    }

    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${detected.ext}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    await this.driver.put(key, file.buffer);

    const row = await this.prisma.uploadFile.create({
      data: {
        userId,
        scope,
        filename: decodeFilename(file.originalname)?.slice(0, 200) || `file.${detected.ext}`,
        storedKey: key,
        mime: detected.mime,
        size: file.size,
        sha256,
        backend: this.driver.name,
      },
    });

    return this.view(row);
  }

  /**
   * 直接写入一段二进制（供图像生成等内部流程使用）。
   * 不走上传校验：调用方已经知道自己产出了什么。
   */
  async saveBuffer(
    userId: string,
    buffer: Buffer,
    opts: { mime: string; filename: string; scope?: string;expiresAt?:Date|null },
  ) {
    const maximum = ['video','video-input'].includes(opts.scope || '') && opts.mime === 'video/mp4' ? 96 * 1024 * 1024 : 20 * 1024 * 1024;
    if (buffer.length > maximum) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '生成结果过大', 413);
    }

    const extFromMime: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'video/mp4': 'mp4',
    };
    const ext = extFromMime[opts.mime] ?? 'bin';

    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    await this.driver.put(key, buffer);

    const row = await this.prisma.uploadFile.create({
      data: {
        userId,
        scope: opts.scope ?? 'image',
        expiresAt:opts.expiresAt??null,
        filename: opts.filename.slice(0, 200),
        storedKey: key,
        mime: opts.mime,
        size: buffer.length,
        sha256,
        backend: this.driver.name,
      },
    });

    return this.view(row);
  }

  private view(row: {
    id: string;
    filename: string;
    mime: string;
    size: number;
    scope: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      scope: row.scope,
      url: `/${this.prefix}/upload/${row.id}/raw`,
      createdAt: row.createdAt,
    };
  }

  private async findOwned(id: string, userId: string, role: string) {
    const row = await this.prisma.uploadFile.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.purgedAt || row.expiresAt && row.expiresAt <= new Date()) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '文件不存在', 404);
    }
    if (row.userId !== userId && (role !== 'ADMIN'||['voice-recording','voice-result','app-icon'].includes(row.scope))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '文件不存在', 404);
    }
    return row;
  }

  async detail(id: string, userId: string, role: string) {
    const row = await this.findOwned(id, userId, role);
    return this.view(row);
  }

  async read(id: string, userId: string, role: string) {
    const row = await this.findOwned(id, userId, role);
    if (['video','video-input'].includes(row.scope) && row.mime === 'video/mp4' && (!row.size || row.size > 96 * 1024 * 1024)) throw new BusinessException(ErrorCode.PARAM_INVALID, '成片大小超过限制');
    const buffer = ['video','video-input'].includes(row.scope) && row.mime === 'video/mp4' ? await streamBuffer(addAbortSignal(AbortSignal.timeout(120000), await this.driver.openRange(row.storedKey, 0, row.size - 1, row.size))) : await this.driver.get(row.storedKey);
    return { buffer, mime: row.mime, filename: row.filename,scope:row.scope };
  }

  async streamRange(id: string, userId: string, role: string, start: number, end: number) {
    const row = await this.findOwned(id, userId, role);
    return { stream: await this.driver.openRange(row.storedKey, start, end, row.size), mime: row.mime, filename: row.filename, total: row.size };
  }

  async remove(id: string, userId: string, role: string) {
    const row = await this.findOwned(id, userId, role);
    if(row.scope==='app-icon') throw new BusinessException(ErrorCode.PARAM_INVALID,'应用图片随应用内容管理，请在编辑页更换',409);
    await this.prisma.uploadFile.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.driver.remove(row.storedKey).catch((e) => this.logger.warn(`删除文件失败: ${e.message}`));
    return { ok: true };
  }

  /** Dedicated voice files remain retryable until storage confirms removal. */
  async purgeVoiceFile(id:string,userId:string,scope:'voice-recording'|'voice-result'){
    const row=await this.prisma.uploadFile.findFirst({where:{id,userId,scope,mime:scope==='voice-recording'?'audio/wav':'audio/mpeg'}});
    if(!row||row.purgedAt)return{purged:true};
    if(!row.deletedAt)throw new Error('Voice file must be withdrawn before physical cleanup');
    await this.driver.remove(row.storedKey);
    await this.prisma.uploadFile.updateMany({where:{id,userId,scope,deletedAt:{not:null},purgedAt:null},data:{purgedAt:new Date()}});
    return{purged:true};
  }

  /** The id identifies one normalized image operation; a retry never replaces its bytes. */
  async saveAppImage(userId:string,id:string,buffer:Buffer){
    const sha256=createHash('sha256').update(buffer).digest('hex');
    const verify=(row:any)=>{
      if(!row||row.userId!==userId||row.scope!=='app-icon'||row.sha256!==sha256)throw new BusinessException(ErrorCode.PARAM_INVALID,'同一图片保存标识不能用于不同内容',409);
      if(row.deletedAt||row.purgedAt||row.expiresAt&&row.expiresAt<=new Date())throw new BusinessException(ErrorCode.PARAM_INVALID,'这份临时图片已过期，请重新选择',409);
      return row;
    };
    const previous=await this.prisma.uploadFile.findUnique({where:{id}});if(previous)return verify(previous);
    const now=new Date(),key=`${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${randomUUID()}.png`;
    await this.driver.put(key,buffer);
    try{const row=await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;
      const actor=await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}});if(!actor)throw new BusinessException(ErrorCode.FORBIDDEN,'当前身份不能保存图片',403);
      const old=await tx.uploadFile.findUnique({where:{id}});if(old)return verify(old);
      if(await tx.uploadFile.count({where:{userId,scope:'app-icon',deletedAt:null,purgedAt:null,expiresAt:{not:null,gt:now}}})>=40)throw new BusinessException(ErrorCode.PARAM_INVALID,'临时图片已满，请先使用已有图片或稍后再试',409);
      return tx.uploadFile.create({data:{id,userId,scope:'app-icon',filename:'QGauss-app-image.png',storedKey:key,mime:'image/png',size:buffer.length,sha256,backend:this.driver.name,expiresAt:new Date(now.getTime()+86400000)}});
    });if(row.storedKey!==key)await this.driver.remove(key).catch(()=>{});return row;}catch(error){await this.driver.remove(key).catch(()=>{});throw error;}
  }

  async purgeAppImage(id:string,userId:string){
    const row=await this.prisma.uploadFile.findFirst({where:{id,userId,scope:'app-icon'}});
    if(!row||row.purgedAt)return;
    if(!row.deletedAt)throw new Error('App image must expire before cleanup');
    await this.driver.remove(row.storedKey);
    await this.prisma.uploadFile.updateMany({where:{id,userId,scope:'app-icon',deletedAt:{not:null},purgedAt:null},data:{purgedAt:new Date()}});
  }

  async listMine(userId: string, page = 1, pageSize = 20) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeSize = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 20;
    const [items, total] = await Promise.all([
      this.prisma.uploadFile.findMany({
        where: { userId, scope:{not:'app-icon'}, deletedAt: null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}] },
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.uploadFile.count({ where: { userId, scope:{not:'app-icon'}, deletedAt: null,purgedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}] } }),
    ]);
    return { items: items.map((r) => this.view(r)), total, page: safePage, pageSize: safeSize };
  }

  /**
   * 就绪探针：只对哨兵键做一次 exists（S3 上就是一次 HEAD），不写入任何对象。
   * 为什么不写一个探针文件：k8s 每几秒探一次，写对象既产生费用又污染桶；
   * 而「404 说明服务可达」已经足够回答「存储能不能用」。
   * 结果缓存 60 秒，避免探活把对象存储打成热点。
   */
  async probe(): Promise<{ driver: string; ok: boolean; error?: string }> {
    const now = Date.now();
    if (this.probeCache && now - this.probeCache.at < 60_000) return this.probeCache.value;

    const sentinel = '1970/01/readinessprobe000000000000000000.png';
    let value: { driver: string; ok: boolean; error?: string };
    try {
      await this.driver.exists(sentinel);
      value = { driver: this.driver.name, ok: true };
    } catch (e) {
      value = {
        driver: this.driver.name,
        ok: false,
        error: String((e as Error)?.message ?? e).slice(0, 120),
      };
    }
    this.probeCache = { at: now, value };
    return value;
  }
}
