import { Injectable, Logger, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { parseTtlMs } from '../../common/utils/ttl.util';
import { SettingsService } from '../settings/settings.service';
import { MailService } from '../mail/mail.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CaptchaService } from './captcha.service';
import { passwordProblem } from '../../common/security/password-policy';
import { EmailVerificationService } from './email-verification.service';

const REFRESH_GRACE_MS = 10_000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly captcha: CaptchaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    @Optional() private readonly emailVerification?: EmailVerificationService,
  ) {}

  /** 老数据库同样要检查：只改环境变量不能消除已落库的默认管理员密码。 */
  async onModuleInit() {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER'] }, status: 'ACTIVE', deletedAt: null },
      select: { passwordHash: true },
    });
    for (const admin of admins) {
      if (await bcrypt.compare('admin123456', admin.passwordHash)) {
        throw new Error('生产启动被拒绝：存在使用默认密码的管理员，请先在受控开发环境通过 POST /api/users/password 修改密码');
      }
    }
  }

  private get accessTtl() {
    return this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
  }

  private get refreshTtl() {
    return this.config.get<string>('JWT_REFRESH_TTL') ?? '30d';
  }

  private sha256(v: string) {
    return createHash('sha256').update(v).digest('hex');
  }

  private strip(user: any) {
    if (!user) return null;
    const { passwordHash, tokenVersion, adminNote, ...rest } = user;
    return rest;
  }

  /** 签发 access + 不透明 refresh（refresh 落库，只存 hash） */
  private async issue(
    user: { id: string; email: string; username: string; role: string; tokenVersion: number; displayName?: string | null; avatar?: string | null; createdAt?: Date; emailVerifiedAt?: Date | null },
    familyId: string,
    meta: { ip?: string; userAgent?: string } = {},
    transaction?: Prisma.TransactionClient,
  ) {
    if (!transaction) return this.prisma.$transaction(async tx => {
      const accepted = await tx.user.updateMany({where:{id:user.id,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null},data:{tokenVersion:{increment:0}}});
      if (accepted.count !== 1) throw new UnauthorizedException({code:2002,message:'账号或密码已变更，请重新登录'});
      return this.issue(user,familyId,meta,tx);
    });
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tv: user.tokenVersion,
        sid: familyId,
        type: 'access',
      },
      { secret: this.config.get<string>('JWT_SECRET'), expiresIn: this.accessTtl as any },
    );

    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + parseTtlMs(this.refreshTtl, 30 * 86400_000));

    const record = await transaction.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: this.sha256(refreshToken),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(parseTtlMs(this.accessTtl) / 1000),
      user: { id: user.id, email: user.email, username: user.username, role: user.role, displayName: user.displayName ?? null, avatar: user.avatar ?? null, createdAt: user.createdAt, emailVerifiedAt: user.emailVerifiedAt ?? null },
      _recordId: record.id,
    };
  }

  async register(dto: RegisterDto, meta: { ip?: string; userAgent?: string } = {}) {
    const registerLimit = await this.settings.get<number>('security.registerRateLimit');
    if (!this.rateLimit.tryConsume(`register:${meta.ip ?? 'unknown'}`, registerLimit)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '注册过于频繁，请稍后再试', 429);
    }

    const registerEnabled = await this.settings.get<boolean>('security.registerEnabled');
    const inviteCode = await this.settings.get<string>('security.registerInviteCode');
    const emailRequired=await this.settings.get<boolean>('security.emailVerificationRequired');

    if (!registerEnabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '当前未开放注册，请联系管理员', 403);
    }
    if (inviteCode && dto.inviteCode !== inviteCode) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '邀请码不正确', 403);
    }
    // 验证码：开启「必须验证码」时缺字段直接拒绝，否则只在客户端提交了才校验
    const captchaEnabled = await this.settings.get<boolean>('security.captchaEnabled');
    if (!emailRequired && captchaEnabled && (!dto.captchaId || !dto.captchaCode)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '请填写验证码');
    }
    if (!emailRequired && dto.captchaId && !this.captcha.verify(dto.captchaId, dto.captchaCode)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '验证码错误或已过期');
    }

    const problem = passwordProblem(dto.password);
    if (problem) throw new BusinessException(ErrorCode.PARAM_INVALID, problem, 422);
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username: dto.username }] },
    });
    if (exists) {
      throw new BusinessException(
        ErrorCode.USER_EXISTS,
        exists.email === email ? '该邮箱已注册' : '该用户名已被占用',
      );
    }

    // 分销邀请码（与上面的站点注册邀请码是两个概念：那个是「准入」，这个是「归属」）。
    // 填了不存在的码不报错——注册不该因为一个可选的分销归属而失败。
    const inviterCode = (dto.inviteCode ?? '').trim().toUpperCase();
    let invitedBy = '';
    if (inviterCode && inviterCode !== inviteCode) {
      const inviter = await this.prisma.user.findFirst({
        where: { inviteCode: inviterCode, isDistribution: true, deletedAt: null },
        select: { id: true },
      });
      if (inviter) invitedBy = inviter.id;
    }

    const proof=emailRequired||dto.emailChallengeId||dto.emailCode ? await this.emailVerification!.claim(dto.emailChallengeId,dto.emailCode,email,'REGISTER',meta.ip) : null;
    const passwordHash=await bcrypt.hash(dto.password,10);
    const user = await this.prisma.$transaction(async tx=>{
      if(proof)await this.emailVerification!.consumeTx(tx,proof);
      return tx.user.create({
      data: {
        email,
        username: dto.username,
        passwordHash,
        ...(proof?{emailVerifiedAt:new Date()}:{}),
        ...(invitedBy ? { invitedBy } : {}),
      },
      });
    });
    this.logger.log(`new user registered: ${user.username}`);

    // 欢迎邮件：await 保证可观测（失败也只记日志，不影响注册）
    await this.mail
      .send('welcome', user.email, { username: user.username })
      .catch((e) => this.logger.warn(`欢迎邮件失败: ${e.message}`));

    const { _recordId, ...tokens } = await this.issue(user, randomUUID());
    return tokens;
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string } = {}) {
    const loginLimit = await this.settings.get<number>('security.loginRateLimit');
    if (!this.rateLimit.tryConsume(`login:${meta.ip ?? 'unknown'}`, loginLimit)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '登录尝试过于频繁，请稍后再试', 429);
    }

    const account = dto.account.trim();

    /** 登录失败：记日志后再抛错，便于后台排查撞库/异常登录 */
    const fail = async (userId: string | null, reason: string, code: number, message: string) => {
      await this.prisma.userLoginLog
        .create({
          data: {
            userId,
            account: dto.account,
            success: false,
            reason,
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        })
        .catch(() => void 0);
      throw new UnauthorizedException({ code, message });
    };

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: account.toLowerCase() }, { username: account }],
        deletedAt: null,
      },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      await fail(user?.id ?? null, 'bad_credentials', 2005, '账号或密码错误');
    }
    if (user!.status !== 'ACTIVE') {
      await fail(user!.id, 'disabled', 2004, '账号已被禁用');
    }

    const { _recordId, ...tokens } = await this.issue(user!, randomUUID(), meta);
    await this.prisma.userLoginLog
      .create({
        data: {
          userId: user!.id,
          account: dto.account,
          success: true,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      })
      .catch(() => void 0);


    return tokens;
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string } = {}) {
    const tokenHash = this.sha256(refreshToken);
    const reference = await this.prisma.refreshToken.findUnique({where:{tokenHash},select:{userId:true}});
    if (!reference) throw new UnauthorizedException({code:2002,message:'登录已失效，请重新登录'});
    const result = await this.prisma.$transaction(async tx => {
      const accepted = await tx.user.updateMany({where:{id:reference.userId,status:'ACTIVE',deletedAt:null},data:{tokenVersion:{increment:0}}});
      if (accepted.count !== 1) return {error:{code:2004,message:'账号状态异常'}};
      const record = await tx.refreshToken.findUnique({where:{tokenHash}});
      const now = new Date();
      if (!record || record.revokedAt || record.expiresAt <= now) return {error:{code:2002,message:'登录已过期，请重新登录'}};
      if (record.usedAt && now.getTime() - record.usedAt.getTime() > REFRESH_GRACE_MS) {
        await tx.refreshToken.updateMany({where:{familyId:record.familyId,revokedAt:null},data:{revokedAt:now}});
        return {error:{code:2002,message:'登录状态异常，请重新登录'}};
      }
      const user = await tx.user.findUniqueOrThrow({where:{id:reference.userId}});
      const {_recordId,...tokens} = await this.issue(user,record.familyId,meta,tx);
      if (!record.usedAt) await tx.refreshToken.update({where:{id:record.id},data:{usedAt:now,replacedById:_recordId}});
      return {tokens};
    });
    if (result.error) throw new UnauthorizedException(result.error);
    return result.tokens;
  }

  async logout(refreshToken?: string, meta: {ip?:string} = {}, accessToken?: string) {
    if (!this.rateLimit.tryConsume('logout:' + (meta.ip ?? 'unknown'),120)) throw new BusinessException(ErrorCode.RATE_LIMITED,'操作过于频繁，请稍后再试',429);
    let record: {familyId:string} | null = null;
    if (refreshToken) record = await this.prisma.refreshToken.findUnique({where:{tokenHash:this.sha256(refreshToken)}});
    else if (accessToken && accessToken.length <= 8192) {
      try {
        const payload = await this.jwt.verifyAsync(accessToken,{secret:this.config.get<string>('JWT_SECRET')});
        if (payload.type === 'access' && typeof payload.sid === 'string' && typeof payload.sub === 'string') record = await this.prisma.refreshToken.findFirst({where:{familyId:payload.sid,userId:payload.sub},select:{familyId:true}});
      } catch { /* Unknown or expired credentials reveal no account information. */ }
    }
    if (record) await this.revokeFamily(record.familyId);
    return { ok: true };
  }

  async revokeFamily(familyId: string) {
    const record = await this.prisma.refreshToken.findFirst({where:{familyId},select:{userId:true}});
    if (!record) return;
    await this.prisma.$transaction(async tx => {
      await tx.user.updateMany({where:{id:record.userId},data:{tokenVersion:{increment:0}}});
      await tx.refreshToken.updateMany({where:{familyId,revokedAt:null},data:{revokedAt:new Date()}});
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * 发起找回密码。
   * 无论邮箱是否存在都返回成功——避免被用来枚举账号。
   */
  async forgotPassword(email: string, meta: {ip?:string} = {}) {
    if (!this.rateLimit.tryConsume('forgot-password:' + (meta.ip ?? 'unknown'),20,15*60_000)) throw new BusinessException(ErrorCode.RATE_LIMITED,'申请过于频繁，请稍后再试',429);
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({where:{email:normalized,deletedAt:null,status:'ACTIVE'}});
    if (!user) return {ok:true};
    const token = randomBytes(24).toString('hex');
    const accepted = await this.prisma.$transaction(async tx => {
      const locked = await tx.user.updateMany({where:{id:user.id,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null},data:{tokenVersion:{increment:0}}});
      if (locked.count !== 1) return false;
      await tx.passwordReset.deleteMany({where:{userId:user.id,usedAt:null}});
      await tx.passwordReset.create({data:{userId:user.id,tokenHash:this.sha256(token),expiresAt:new Date(Date.now()+30*60_000)}});
      return true;
    });
    if (!accepted) return {ok:true};
    const baseUrl = await this.settings.get<string>('site.baseUrl');
    await this.mail.send('resetPassword',user.email,{username:user.username,resetUrl:baseUrl.replace(/\/+$/,'')+'/reset-password?token='+token}).catch(error=>this.logger.warn('重置邮件失败: '+error.message));
    return {ok:true};
  }

  async resetPassword(token: string, newPassword: string, meta: {ip?:string} = {}) {
    if (!this.rateLimit.tryConsume('reset-password:' + (meta.ip ?? 'unknown'),40,15*60_000)) throw new BusinessException(ErrorCode.RATE_LIMITED,'尝试过于频繁，请稍后再试',429);
    const row = await this.prisma.passwordReset.findUnique({where:{tokenHash:this.sha256(token)}});
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw new BusinessException(ErrorCode.PARAM_INVALID,'链接无效或已过期，请重新申请');
    const user = await this.prisma.user.findUnique({where:{id:row.userId}});
    if (!user || user.deletedAt) throw new BusinessException(ErrorCode.NOT_FOUND,'用户不存在',404);
    if (user.status !== 'ACTIVE') throw new BusinessException(ErrorCode.ACCOUNT_BANNED,'账号暂不可修改密码，请联系管理员',403);
    const problem = passwordProblem(newPassword, user.role === 'ADMIN');
    if (problem) throw new BusinessException(ErrorCode.PARAM_INVALID, problem, 422);
    const passwordHash = await bcrypt.hash(newPassword,10);
    await this.prisma.$transaction(async tx => {
      const now = new Date();
      const changed = await tx.user.updateMany({where:{id:user.id,passwordHash:user.passwordHash,tokenVersion:user.tokenVersion,status:'ACTIVE',deletedAt:null},data:{passwordHash,tokenVersion:{increment:1}}});
      if (changed.count !== 1) throw new BusinessException(ErrorCode.PARAM_INVALID,'链接无效或账号已变更，请重新申请');
      const claimed = await tx.passwordReset.updateMany({where:{id:row.id,userId:user.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
      if (claimed.count !== 1) throw new BusinessException(ErrorCode.PARAM_INVALID,'链接无效或已过期，请重新申请');
      await tx.passwordReset.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:now}});
      await tx.refreshToken.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:now}});
    });
    this.logger.log('password reset completed');
    return {ok:true};
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException({ code: 2001, message: '用户不存在' });
    return this.strip(user);
  }
}
