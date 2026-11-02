import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { yuanToCents } from '../../common/money/money';
import { page, toInt, toStr } from '../../common/params';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { SettingsService } from '../settings/settings.service';
import { LedgerService } from './ledger.service';
import { captureOffer, offerRevision, validOffer } from './order-offer';

/**
 * 卡密
 *
 * 设计要点：
 *   1. 码面「归一化」存储：库里只存 12 位大写字母数字，展示时再分组加横线。
 *      这样用户输入带不带横线、大小写如何都能命中，不存在同一张卡有两种写法。
 *   2. 卡密是「快照」：生成时把套餐的次数/天数复制到 crami 行。之后改套餐
 *      不会追溯影响已发出的卡（否则已卖出的卡面值会凭空变化）。
 *   3. 核销必须原子：抢占用（条件更新）+ 核销记录（唯一键）+ 发放（账本）
 *      三件事在同一个事务里，任何一步失败整体回滚，不会出现「卡废了但没到账」。
 */

/** 去掉易混字符 I / L / O / 0 / 1，降低人工输入错误率 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 12;

function rawCramiCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** 展示用分组：ABCD-EFGH-IJKL */
function groupCode(code: string): string {
  const s = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return s.replace(/(.{4})(?=.)/g, '$1-');
}

/** 归一化用户输入：去掉一切分隔符并大写 */
function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export interface PackageDto {
  name?: unknown;
  nameEn?: unknown;
  nameTw?: unknown;
  des?: unknown;
  desEn?: unknown;
  desTw?: unknown;
  coverImg?: unknown;
  priceYuan?: unknown;
  priceCents?: unknown;
  sort?: unknown;
  status?: unknown;
  weight?: unknown;
  days?: unknown;
  model3Count?: unknown;
  model4Count?: unknown;
  drawMjCount?: unknown;
  agentCount?: unknown;
}

@Injectable()
export class CramiService {
  private readonly logger = new Logger(CramiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly rate: RateLimitService,
  ) {}

  // ---------------------------------------------------------------------------
  // 套餐
  // ---------------------------------------------------------------------------

  /** 前台可售套餐（未下架、未删除） */
  async publicPackages() {
    const items = await this.prisma.cramiPackage.findMany({
      where: { status: 1, deletedAt: null },
      orderBy: [{ sort: 'desc' }, { createdAt: 'asc' }],
    });
    return { items: items.map((p) => this.packageView(p)) };
  }

  async listPackages(q: { page?: unknown; pageSize?: unknown; status?: unknown; keyword?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.CramiPackageWhereInput = { deletedAt: null };
    if (q.status !== undefined && q.status !== '') where.status = toInt(q.status, 1, 0, 1, '状态');
    const keyword = toStr(q.keyword, '', 60).trim();
    if (keyword) where.name = { contains: keyword };
    const [items, total] = await Promise.all([
      this.prisma.cramiPackage.findMany({
        where,
        orderBy: [{ sort: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.cramiPackage.count({ where }),
    ]);
    return { items: items.map((i) => this.packageView(i)), total, page: p, pageSize };
  }

  async createPackage(dto: PackageDto) {
    const data = this.packageData(dto, true);
    return this.packageView(await this.prisma.cramiPackage.create({ data }));
  }

  async updatePackage(id: string, dto: PackageDto) {
    await this.assertPackage(id);
    const data = this.packageData(dto, false);
    return this.packageView(await this.prisma.cramiPackage.update({ where: { id }, data }));
  }

  /** 软删。已发出的卡密继续有效（它们有独立快照），这是刻意的 */
  async removePackage(id: string) {
    await this.assertPackage(id);
    await this.prisma.cramiPackage.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }

  private async assertPackage(id: string) {
    const pkg = await this.prisma.cramiPackage.findFirst({ where: { id, deletedAt: null } });
    if (!pkg) throw new BusinessException(ErrorCode.NOT_FOUND, '套餐不存在', 404);
    return pkg;
  }

  /**
   * 组装套餐字段。
   * create=true 时校验必填（名称/价格）；update 时只处理传入的字段，
   * 避免「一次 PATCH 把没传的字段清零」这种经典事故。
   */
  private packageData(dto: PackageDto, create: boolean): Prisma.CramiPackageCreateInput {
    const data: Record<string, unknown> = {};

    const name = toStr(dto.name, '', 60).trim();
    if (create && !name) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐名称不能为空');
    if (dto.name !== undefined) data.name = name;

    for (const key of ['nameEn', 'nameTw', 'des', 'desEn', 'desTw', 'coverImg'] as const) {
      if (dto[key] !== undefined) data[key] = toStr(dto[key], '', key === 'coverImg' ? 500 : 1000);
    }

    if (dto.priceYuan !== undefined && dto.priceYuan !== null && dto.priceYuan !== '') {
      const cents = yuanToCents(dto.priceYuan);
      if (cents === null) throw new BusinessException(ErrorCode.PARAM_INVALID, '价格格式不正确（最多两位小数）');
      data.priceCents = cents;
    } else if (dto.priceCents !== undefined) {
      data.priceCents = toInt(dto.priceCents, 0, 0, 100_000_000, '价格（分）');
    } else if (create) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少价格');
    }

    if (dto.sort !== undefined) data.sort = toInt(dto.sort, 100, 0, 100_000, '排序值');
    if (dto.weight !== undefined) data.weight = toInt(dto.weight, 0, 0, 100_000, '权重');
    if (dto.status !== undefined) data.status = toInt(dto.status, 1, 0, 1, '状态');
    // days=-1 表示永久会员
    if (dto.days !== undefined) data.days = toInt(dto.days, 0, -1, 36_500, '会员天数');
    for (const key of ['model3Count', 'model4Count', 'drawMjCount', 'agentCount'] as const) {
      if (dto[key] !== undefined) data[key] = toInt(dto[key], 0, 0, 10_000_000, '次数');
    }

    return data as Prisma.CramiPackageCreateInput;
  }

  private packageView(p: {
    id: string;
    name: string;
    nameEn: string;
    nameTw: string;
    des: string;
    coverImg: string;
    priceCents: number;
    sort: number;
    status: number;
    weight: number;
    days: number;
    model3Count: number;
    model4Count: number;
    drawMjCount: number;
    agentCount: number;
    createdAt: Date;
  }) {
    return {
      ...p,
      priceYuan: (p.priceCents / 100).toFixed(2),
      offerRevision: validOffer(captureOffer(p)) ? offerRevision(captureOffer(p)) : '',
      totalCount: p.model3Count + p.model4Count + p.drawMjCount + p.agentCount,
    };
  }

  // ---------------------------------------------------------------------------
  // 卡密
  // ---------------------------------------------------------------------------

  /**
   * 批量生成卡密。
   * 面值默认取套餐快照，也允许本次覆盖（例如给某个活动单独发一张更高面值的卡）。
   */
  async generate(adminId: string, dto: Record<string, unknown>) {
    const packageId = toStr(dto.packageId, '', 40);
    if (!packageId) throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少套餐 packageId');
    const pkg = await this.assertPackage(packageId);

    const count = toInt(dto.count, 1, 1, 500, '生成数量');
    const cramiType = toInt(dto.cramiType, 1, 1, 2, '卡密类型');
    const days = dto.days === undefined ? pkg.days : toInt(dto.days, pkg.days, -1, 36_500, '会员天数');
    const counts = {
      model3Count: dto.model3Count === undefined ? pkg.model3Count : toInt(dto.model3Count, 0, 0, 10_000_000, '次数'),
      model4Count: dto.model4Count === undefined ? pkg.model4Count : toInt(dto.model4Count, 0, 0, 10_000_000, '次数'),
      drawMjCount: dto.drawMjCount === undefined ? pkg.drawMjCount : toInt(dto.drawMjCount, 0, 0, 10_000_000, '次数'),
      agentCount: dto.agentCount === undefined ? pkg.agentCount : toInt(dto.agentCount, 0, 0, 10_000_000, '次数'),
    };

    // 12 位 31 进制的碰撞概率可以忽略，但既然撞上就不能静默少发，重试一次即可
    let created = 0;
    for (let attempt = 0; attempt < 2 && created === 0; attempt += 1) {
      const codes = new Set<string>();
      while (codes.size < count) codes.add(rawCramiCode());
      try {
        const res = await this.prisma.crami.createMany({
          data: [...codes].map((code) => ({ code, cramiType, packageId, days, ...counts })),
        });
        created = res.count;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt === 0) {
          this.logger.warn(`卡密生成撞码，重试一次（${count} 张）`);
          continue;
        }
        throw err;
      }
    }
    this.logger.log(`管理员 ${adminId} 生成 ${created} 张卡密（套餐 ${pkg.name}）`);
    return { requested: count, created, packageId, cramiType, days, ...counts };
  }

  async listCramis(q: {
    page?: unknown;
    pageSize?: unknown;
    packageId?: unknown;
    status?: unknown;
    keyword?: unknown;
  }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.CramiWhereInput = {};
    const packageId = toStr(q.packageId, '', 40);
    if (packageId) where.packageId = packageId;
    if (q.status !== undefined && q.status !== '') where.status = toInt(q.status, 0, 0, 2, '状态');
    const keyword = normalizeCode(q.keyword);
    if (keyword) where.code = { contains: keyword };

    const [items, total] = await Promise.all([
      this.prisma.crami.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.crami.count({ where }),
    ]);
    return {
      items: items.map((i) => ({ ...i, codeDisplay: groupCode(i.code) })),
      total,
      page: p,
      pageSize,
    };
  }

  /** 作废：只有未使用的卡可以作废；已作废的重复调用是幂等的 */
  async voidCrami(id: string) {
    const crami = await this.prisma.crami.findUnique({ where: { id } });
    if (!crami) throw new BusinessException(ErrorCode.CRAMI_NOT_FOUND, '卡密不存在', 404);
    if (crami.status === 1) throw new BusinessException(ErrorCode.CRAMI_UNAVAILABLE, '已使用的卡密不能作废', 409);
    if (crami.status === 2) return { id, status: 2 };
    await this.prisma.crami.updateMany({ where: { id, status: 0 }, data: { status: 2 } });
    return { id, status: 2 };
  }

  /**
   * 核销卡密。整个流程在一个事务里：
   *   抢占用（type=1）→ 写核销记录（唯一键兜重复）→ 发放 → 回填流水号
   */
  async exchange(userId: string, rawInput: unknown) {
    // 核销是"猜码"的天然入口：先限流再判断对错，否则可以无限次试
    const limit = Number(await this.settings.get<number>('commerce.exchangeRateLimit')) || 10;
    if (!this.rate.tryConsume(`cramiExchange:${userId}`, limit, 60_000)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '核销过于频繁，请稍后再试', 429);
    }

    const norm = normalizeCode(rawInput);
    if (norm.length !== CODE_LEN) {
      throw new BusinessException(ErrorCode.CRAMI_NOT_FOUND, '卡密格式不正确（应为 12 位）', 404);
    }
    const crami = await this.prisma.crami.findUnique({ where: { code: norm } });
    if (!crami) throw new BusinessException(ErrorCode.CRAMI_NOT_FOUND, '卡密不存在', 404);
    if (crami.status === 2) throw new BusinessException(ErrorCode.CRAMI_UNAVAILABLE, '卡密已作废', 409);
    if (crami.cramiType === 1 && crami.status === 1) {
      throw new BusinessException(ErrorCode.CRAMI_UNAVAILABLE, '卡密已被使用', 409);
    }

    // 余额行必须在事务外建好（upsert 在事务里也可以，但两个 upsert 会加长写锁持有时间）
    await this.ledger.ensure(userId);

    const accountLog = await this.prisma.$transaction(async (tx) => {
      if (crami.cramiType === 1) {
        const claimed = await tx.crami.updateMany({
          where: { id: crami.id, status: 0 },
          data: { status: 1, useId: userId, usedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new BusinessException(ErrorCode.CRAMI_UNAVAILABLE, '卡密已被使用', 409);
        }
      }

      let use;
      try {
        use = await tx.cramiUse.create({
          data: {
            cramiId: crami.id,
            cramiCode: groupCode(crami.code),
            userId,
            packageId: crami.packageId,
            cramiType: crami.cramiType,
            days: crami.days,
            model3Count: crami.model3Count,
            model4Count: crami.model4Count,
            drawMjCount: crami.drawMjCount,
            agentCount: crami.agentCount,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BusinessException(ErrorCode.CRAMI_UNAVAILABLE, '这张卡密你已经使用过了', 409);
        }
        throw err;
      }

      const log = await this.ledger.grantTx(tx, userId, {
        model3Count: crami.model3Count,
        model4Count: crami.model4Count,
        drawMjCount: crami.drawMjCount,
        agentCount: crami.agentCount,
        days: crami.days,
        packageId: crami.packageId,
        rechargeType: 'crami',
        remark: `卡密核销 ${groupCode(crami.code)}`,
      });

      await tx.cramiUse.update({ where: { id: use.id }, data: { accountLogId: log.id } });

      // 多人共用的卡（type=2）仍然保持 status=0，只记录最后一个使用者
      if (crami.cramiType === 2) {
        await tx.crami.update({ where: { id: crami.id }, data: { useId: userId, usedAt: new Date() } });
      }
      return log;
    });

    const balance = await this.ledger.view(userId);
    return {
      code: groupCode(crami.code),
      packageId: crami.packageId,
      cramiType: crami.cramiType,
      granted: {
        days: crami.days,
        model3Count: crami.model3Count,
        model4Count: crami.model4Count,
        drawMjCount: crami.drawMjCount,
        agentCount: crami.agentCount,
      },
      accountLogId: accountLog.id,
      balance,
    };
  }

  /** 我的核销记录 */
  async myUses(userId: string, q: { page?: unknown; pageSize?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.cramiUse.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.cramiUse.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  /** 后台统计：各状态卡密数量（用于列表页顶部卡片） */
  async stats() {
    const [unused, used, voided] = await Promise.all([
      this.prisma.crami.count({ where: { status: 0 } }),
      this.prisma.crami.count({ where: { status: 1 } }),
      this.prisma.crami.count({ where: { status: 2 } }),
    ]);
    return { unused, used, voided, total: unused + used + voided };
  }
}
