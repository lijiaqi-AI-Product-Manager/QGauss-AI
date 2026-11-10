import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { formatCents, yuanToCents } from '../../common/money/money';
import { page } from '../../common/params';
import { LedgerService } from './ledger.service';
import { createHash } from 'node:crypto';

export interface ManualGrantDto {
  userId: string;
  model3Count?: number;
  model4Count?: number;
  drawMjCount?: number;
  agentCount?: number;
  days?: number;
  amountYuan?: number | string;
  packageId?: string;
  extent?: string;
  remark?: string;
  requestKey?: string;
  expectedUpdatedAt?: string;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  /** 前台余额概览：次数 + 金额 + 最近流水 */
  async overview(userId: string) {
    const view = await this.ledger.view(userId);
    const currency = await this.settings.get<string>('commerce.currency');
    const recent = await this.prisma.balanceConsumeLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        direction: true,
        sourceLogId: true,
        refId: true,
        deductionType: true,
        amount: true,
        bizType: true,
        modelName: true,
        remark: true,
        createdAt: true,
      },
    });
    return {
      ...view,
      currency,
      balanceYuan: formatCents(view.balanceCents),
      recent,
    };
  }

  async consumeLogs(userId: string, q: { page?: unknown; pageSize?: unknown; bizType?: string; deductionType?: unknown; direction?: unknown; keyword?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Prisma.BalanceConsumeLogWhereInput = { userId, ...(q.bizType ? { bizType: String(q.bizType) } : {}) };
    if (q.deductionType !== undefined && q.deductionType !== '') {
      if (typeof q.deductionType !== 'string' || !['model3', 'model4', 'drawMj', 'agent', 'money'].includes(q.deductionType)) throw new BusinessException(ErrorCode.PARAM_INVALID, '额度类型无效', 400);
      where.deductionType = q.deductionType;
    }
    if (q.direction !== undefined && q.direction !== '') {
      if (!['string', 'number'].includes(typeof q.direction) || !/^[1-6]$/.test(String(q.direction))) throw new BusinessException(ErrorCode.PARAM_INVALID, '流水动作无效', 400);
      where.direction = Number(q.direction);
    }
    if (q.keyword !== undefined) {
      if (typeof q.keyword !== 'string' || q.keyword.length > 100) throw new BusinessException(ErrorCode.PARAM_INVALID, '搜索词须在 100 字以内', 400);
      const contains = q.keyword.trim();
      if (contains) where.OR = [{ modelName: { contains } }, { remark: { contains } }, { refId: { contains } }, { uid: { contains } }];
    }
    const [items, total] = await Promise.all([
      this.prisma.balanceConsumeLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.balanceConsumeLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  /** 管理员视角：全部用户的消费流水 */
  async allConsumeLogs(q: { page?: unknown; pageSize?: unknown; userId?: string; bizType?: string }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where: Record<string, unknown> = {};
    if (q.userId) where.userId = String(q.userId);
    if (q.bizType) where.bizType = String(q.bizType);
    const [items, total] = await Promise.all([
      this.prisma.balanceConsumeLog.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.balanceConsumeLog.count({ where: where as never }),
    ]);
    return { items, total, page: p, pageSize };
  }

  async rechargeLogs(userId: string, q: { page?: unknown; pageSize?: unknown }) {
    const { skip, take, page: p, pageSize } = page(q);
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.accountLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.accountLog.count({ where }),
    ]);
    return { items, total, page: p, pageSize };
  }

  /** 后台手工充值/发放 */
  async manualGrant(adminId: string, dto: ManualGrantDto) {
    const invalid=(message:string):never=>{throw new BusinessException(ErrorCode.PARAM_INVALID,message,400);};
    const allowed=new Set(['userId','model3Count','model4Count','drawMjCount','agentCount','days','amountYuan','packageId','extent','remark','requestKey','expectedUpdatedAt']);
    if(!dto||typeof dto!=='object'||Array.isArray(dto)||Object.keys(dto).some(key=>!allowed.has(key)))return invalid('发放内容不正确');
    if(typeof dto.userId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(dto.userId))return invalid('用户编号不正确');
    const counts={model3Count:dto.model3Count??0,model4Count:dto.model4Count??0,drawMjCount:dto.drawMjCount??0,agentCount:dto.agentCount??0};
    for(const value of Object.values(counts))if(!Number.isSafeInteger(value)||value<0||value>1_000_000)return invalid('每项次数须为 0 到 1000000 的整数');
    const days=dto.days??0;if(!Number.isSafeInteger(days)||days< -1||days>36500)return invalid('会员天数须为 -1 到 36500 的整数');
    for(const [value,max] of [[dto.packageId,128],[dto.extent,20000],[dto.remark,500]] as const)if(value!==undefined&&(typeof value!=='string'||value.length>max))return invalid('发放说明过长或格式不正确');
    if(dto.requestKey!==undefined&&(typeof dto.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(dto.requestKey)))return invalid('发放请求编号不正确');
    if(dto.expectedUpdatedAt!==undefined&&(typeof dto.expectedUpdatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(dto.expectedUpdatedAt)||!Number.isFinite(Date.parse(dto.expectedUpdatedAt))))return invalid('用户核对时间不正确');
    let amountCents=0;
    if (dto.amountYuan !== undefined && dto.amountYuan !== null && dto.amountYuan !== '') {
      const cents = yuanToCents(dto.amountYuan);
      if (cents === null || cents > 2_147_483_647) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '金额格式不正确（最多两位小数）');
      }
      amountCents = cents;
    }

    if(!Object.values(counts).some(Boolean)&&!days&&!amountCents)return invalid('至少填写一项发放内容');
    const packageId=dto.packageId??'',extent=dto.extent??'',remark=dto.remark?.trim()||`管理员 ${adminId} 手工发放`;
    const uid=dto.requestKey?'admin-'+createHash('sha256').update(adminId+'\0'+dto.requestKey).digest('hex'):null;
    return this.prisma.$transaction(async tx=>{
      // Take the writer lock before reviewing actor, target and an existing receipt.
      await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${adminId}`;
      if(!await tx.user.findFirst({where:{id:adminId,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号无权发放额度',403);
      const existing=uid?await tx.accountLog.findUnique({where:{uid}}):null;
      if(existing){
        if(existing.userId!==dto.userId||existing.rechargeType!=='admin'||existing.amountCents!==amountCents||existing.days!==days||existing.packageId!==packageId||existing.extent!==extent||existing.remark!==remark||Object.entries(counts).some(([key,value])=>existing[key as keyof typeof counts]!==value))throw new BusinessException(ErrorCode.PARAM_INVALID,'原发放内容已变化，请重新核对',409);
        return existing;
      }
      const user=await tx.user.findFirst({where:{id:dto.userId,deletedAt:null},select:{id:true,status:true,updatedAt:true}});
      if(!user)throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在',404);
      if(user.status!=='ACTIVE')throw new BusinessException(ErrorCode.PARAM_INVALID,'请先恢复用户账号再发放',409);
      if(dto.expectedUpdatedAt&&user.updatedAt.toISOString()!==dto.expectedUpdatedAt)throw new BusinessException(ErrorCode.PARAM_INVALID,'用户资料已变化，请重新核对',409);
      const balances=await this.ledger.ensureTx(tx,dto.userId);
      for(const [field,value] of Object.entries(counts))if(balances.userBalance[field as keyof typeof counts]+value>2_147_483_647)return invalid('发放后次数超出账户上限');
      if(balances.balance.balanceCents+amountCents>2_147_483_647)return invalid('发放后余额超出账户上限');
      const log=await this.ledger.grantTx(tx,dto.userId,{...counts,days,amountCents,packageId,extent,rechargeType:'admin',remark});
      return uid?tx.accountLog.update({where:{id:log.id},data:{uid}}):log;
    });
  }

  /**
   * 游客数据继承：允许未登录游客先试用、注册后继承。
   * 本项目没有游客账号体系（未登录根本无法发起对话），因此这里是显式的空实现，
   * 返回结构化结果而不是 404，避免前端按既有契约调用时报错。
   */
  async visitorCount(_userId: string) {
    return { count: 0, supported: false };
  }

  async inheritVisitorData(_userId: string) {
    return { inherited: 0, supported: false };
  }
}
