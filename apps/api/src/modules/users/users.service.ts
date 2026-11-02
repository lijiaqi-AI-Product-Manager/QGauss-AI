import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { passwordProblem } from '../../common/security/password-policy';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly rateLimit: RateLimitService) {}

  private strip(user: any) {
    if (!user) return null;
    const { passwordHash, tokenVersion, ...rest } = user;
    return rest;
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    return this.strip(user);
  }

  async updateProfile(userId: string, data: { displayName?: string; avatar?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName.trim() } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      },
    });
    return this.strip(user);
  }

  /**
   * 改密：校验原密码 → 更新 hash → tokenVersion +1 → 吊销全部 refresh。
   * tokenVersion 变化会让所有已签发的 access token 在下一次请求时失效。
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (!this.rateLimit.tryConsume('change-password:' + userId, 5, 15 * 60_000)) throw new BusinessException(ErrorCode.RATE_LIMITED, '修改密码过于频繁，请稍后再试', 429);
    if (oldPassword === newPassword) throw new BusinessException(ErrorCode.PARAM_INVALID, '新密码不能与当前密码相同');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new BusinessException(ErrorCode.CREDENTIAL_INVALID, '原密码不正确');
    }

    const problem = passwordProblem(newPassword, user.role === 'ADMIN');
    if (problem) throw new BusinessException(ErrorCode.PARAM_INVALID, problem, 422);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({where:{id:userId,passwordHash:user.passwordHash,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null},data:{passwordHash,tokenVersion:{increment:1}}});
      if (changed.count !== 1) throw new BusinessException(ErrorCode.CREDENTIAL_INVALID, '账号或密码已变更，请重新登录后操作', 409);
      const now = new Date();
      await tx.refreshToken.updateMany({where:{userId,revokedAt:null},data:{revokedAt:now}});
      await tx.passwordReset.updateMany({where:{userId,usedAt:null},data:{usedAt:now}});
    });

    return { ok: true };
  }

  async list(page = 1, pageSize = 20, keyword?: string) {
    const where = {
      deletedAt: null,
      ...(keyword
        ? {
            OR: [
              { email: { contains: keyword } },
              { username: { contains: keyword } },
              { displayName: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** 封禁/解封：封禁时立即失效所有凭证 */
  async setStatus(id: string, status: 'ACTIVE' | 'DISABLED', actorId?: string) {
    // 自己把自己禁用 = 把唯一管理员锁在门外，直接拒绝
    if (actorId && actorId === id && status === 'DISABLED') {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '不能禁用自己的账号');
    }

    // 先查再改：直接 update 不存在的 id 会抛 P2025，前端只会看到 500
    const exists = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    if (status === 'DISABLED') {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return this.strip(user);
  }

  /** 登录日志 */
  async listLoginLogs(id: string, page = 1, pageSize = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BusinessException(ErrorCode.PARAM_INVALID, '登录记录分页参数无效');
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userLoginLog.findMany({
        where: { userId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userLoginLog.count({ where: { userId: id } }),
    ]);
    return { items, total, page, pageSize };
  }

  async ownLoginLogs(userId: string, page = 1, pageSize = 4) {
    const result = await this.listLoginLogs(userId, page, pageSize);
    return {...result,items:result.items.map(({id,success,ip,userAgent,createdAt})=>({id,success,ip,userAgent,createdAt}))};
  }

  /**
   * 踢下线：不改账号状态，只让凭证立即失效。
   * tokenVersion +1 让已签发的 access token 失效；同时吊销全部 refresh。
   */
  async kickOffline(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在', 404);

    await this.prisma.user.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
}
