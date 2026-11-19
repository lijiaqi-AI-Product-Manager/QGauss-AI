import { Injectable } from '@nestjs/common';
import { AdminAuthenticator, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { compare } from 'bcryptjs';
import { AuthSessionContext, AuthUser, authSession } from '../../common/decorators/current-user.decorator';
import { SecretBox } from '../../common/crypto/secret-box';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { canUseAdminVerification } from '../../common/security/admin-verification';
import { AuthService } from './auth.service';
import { phoneSession as activeAccountSession } from './phone-session';
import { acceptedAuthenticatorCounter, authenticatorSecret, newRecoveryCodes, recoveryCodeHash } from './admin-totp';

type Input = Record<string, unknown>;
type Meta = { ip?: string; userAgent?: string };
type ProofChange = Pick<AdminAuthenticator, 'lastCounter' | 'recoveryHashes'>;
const ENROLLMENT_MS = 10 * 60_000;
const RECENT_VERIFICATION_MS = 5 * 60_000;
const clearedEnrollment = {
  enrollmentId: null, enrollmentEnc: null, enrollmentFamilyId: null, enrollmentExpiresAt: null,
};

function validateCode(input: unknown) {
  return typeof input === 'string' && input.length <= 48 ? input.trim() : '';
}

function codeError() {
  return new BusinessException(ErrorCode.ADMIN_VERIFICATION_INVALID, '验证码或恢复码无效、已使用或已过期', 422);
}

function recoveryHashes(row: AdminAuthenticator): string[] {
  const list: unknown = JSON.parse(row.recoveryHashes);
  if (!Array.isArray(list) || list.length > 8 || list.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Invalid recovery code records');
  }
  return list;
}

function recentProof(row: AdminAuthenticator, context: AuthSessionContext, now = Date.now()) {
  return !!row.enabledAt && typeof context.adminVerifiedAt === 'number' && context.adminVerifiedAt >= row.enabledAt.getTime() &&
    context.adminVerifiedAt <= now && now - context.adminVerifiedAt < RECENT_VERIFICATION_MS;
}

@Injectable()
export class AdminVerificationService {
  constructor(
    private readonly db: PrismaService,
    private readonly box: SecretBox,
    private readonly rate: RateLimitService,
    private readonly auth: AuthService,
  ) {}

  private ensureAdmin(role: string) {
    if (!canUseAdminVerification(role)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '此设置仅适用于管理员', 403);
    }
  }

  private limit(actor: AuthUser, scope: 'manage' | 'enable' | 'verify') {
    this.ensureAdmin(actor.role);
    if (!this.rate.tryConsume('admin-verification:' + scope + ':' + actor.id, 8, 5 * 60_000)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '验证尝试过多，请稍后再试', 429);
    }
  }

  private consume(row: AdminAuthenticator, supplied: unknown, now: Date): { changes: Partial<ProofChange>; recoveryUsed: boolean } {
    const code = validateCode(supplied);
    if (/^\d{6}$/.test(code) && row.secretEnc) {
      const counter = acceptedAuthenticatorCounter(this.box.decrypt(row.secretEnc), code, now.getTime(), row.lastCounter);
      if (counter !== null) return { changes: { lastCounter: counter }, recoveryUsed: false };
    }
    const hash = recoveryCodeHash(row.userId, code);
    if (hash) {
      const hashes = recoveryHashes(row);
      if (hashes.includes(hash)) return { changes: { recoveryHashes: JSON.stringify(hashes.filter(item => item !== hash)) }, recoveryUsed: true };
    }
    throw codeError();
  }

  private async current(tx: Prisma.TransactionClient, actor: AuthUser) {
    const { user, context } = await activeAccountSession(tx, actor);
    this.ensureAdmin(user.role);
    const row = await tx.adminAuthenticator.findUnique({ where: { userId: actor.id } });
    return { user, context, row };
  }

  private async management(tx: Prisma.TransactionClient, actor: AuthUser, input: Input) {
    const state = await this.current(tx, actor);
    const password = input?.password;
    if (!state.user.passwordConfigured || typeof password !== 'string' || !password || password.length > 256 ||
        !await compare(password, state.user.passwordHash)) {
      throw new BusinessException(ErrorCode.CREDENTIAL_INVALID, '请填写当前账号密码', 422);
    }
    const { row, context } = state;
    if (context.adminVerificationRequired) {
      throw new BusinessException(ErrorCode.ADMIN_VERIFICATION_REQUIRED, '请先完成管理员两步验证', 403);
    }
    const changes = row?.enabledAt && !recentProof(row, context) ?
      this.consume(row, input?.code, new Date()).changes : {};
    return { ...state, changes };
  }

  async status(actor: AuthUser) {
    this.ensureAdmin(actor.role);
    const context = authSession(actor);
    if (context?.adminVerificationRequired) return { enabled: true, required: true };
    const [row, user] = await Promise.all([
      this.db.adminAuthenticator.findUnique({ where: { userId: actor.id } }),
      this.db.user.findUnique({ where: { id: actor.id }, select: { passwordConfigured: true } }),
    ]);
    return {
      enabled: !!row?.enabledAt, required: false, canManage: user?.passwordConfigured === true,
      enabledAt: row?.enabledAt ?? null, recoveryRemaining: row?.enabledAt ? recoveryHashes(row).length : 0,
      currentCodeRequired: !!row?.enabledAt && (!context || !recentProof(row, context)),
    };
  }

  async begin(actor: AuthUser, input: Input) {
    this.limit(actor, 'manage');
    return this.db.$transaction(async tx => {
      const { user, context, changes } = await this.management(tx, actor, input);
      const secret = authenticatorSecret();
      const enrollmentId = randomUUID();
      const expiresAt = new Date(Date.now() + ENROLLMENT_MS);
      const setup = {
        enrollmentId, enrollmentEnc: this.box.encrypt(secret), enrollmentFamilyId: context.familyId, enrollmentExpiresAt: expiresAt,
      };
      await tx.adminAuthenticator.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...setup },
        update: { ...setup, ...changes },
      });
      const issuer = encodeURIComponent('QGauss AI');
      const label = encodeURIComponent(user.email || user.username);
      return { enrollmentId, secret, expiresAt, uri: 'otpauth://totp/' + issuer + ':' + label + '?secret=' + secret + '&issuer=' + issuer + '&digits=6&period=30' };
    });
  }

  async enable(actor: AuthUser, input: Input, meta: Meta) {
    this.limit(actor, 'enable');
    return this.db.$transaction(async tx => {
      const { user, context, row } = await this.current(tx, actor);
      const now = new Date();
      if (context.adminVerificationRequired || !row?.enrollmentEnc || !row.enrollmentExpiresAt || row.enrollmentExpiresAt <= now ||
          row.enrollmentId !== input?.enrollmentId || row.enrollmentFamilyId !== context.familyId) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '设置已过期，请重新配对验证器', 409);
      }
      const counter = acceptedAuthenticatorCounter(this.box.decrypt(row.enrollmentEnc), validateCode(input?.code), now.getTime(), -1);
      if (counter === null) throw codeError();
      const codes = newRecoveryCodes();
      await tx.adminAuthenticator.update({
        where: { userId: user.id },
        data: {
          secretEnc: row.enrollmentEnc, enabledAt: now, lastCounter: counter, ...clearedEnrollment,
          recoveryHashes: JSON.stringify(codes.map(code => recoveryCodeHash(user.id, code))),
        },
      });
      const session = await this.auth.rotateAdminSession(tx, user, context.familyId, meta, now, true);
      return { session, recoveryCodes: codes };
    });
  }

  async verify(actor: AuthUser, input: Input, meta: Meta) {
    this.limit(actor, 'verify');
    return this.db.$transaction(async tx => {
      const { user, context, row } = await this.current(tx, actor);
      if (!row?.enabledAt || !context.adminVerificationRequired) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '此登录的验证状态已变化，请重新打开页面', 409);
      }
      const now = new Date();
      const { changes, recoveryUsed } = this.consume(row, input?.code, now);
      await tx.adminAuthenticator.update({ where: { userId: user.id }, data: changes });
      const session = await this.auth.rotateAdminSession(tx, user, context.familyId, meta, now, false);
      await tx.userLoginLog.create({ data: { userId: user.id, account: user.username, success: true, ...meta } });
      return { session, recoveryUsed, recoveryRemaining: recoveryHashes({ ...row, ...changes }).length };
    });
  }

  async rotateRecoveryCodes(actor: AuthUser, input: Input) {
    this.limit(actor, 'manage');
    return this.db.$transaction(async tx => {
      const { user, row, changes } = await this.management(tx, actor, input);
      if (!row?.enabledAt) throw new BusinessException(ErrorCode.PARAM_INVALID, '请先开启管理员两步验证', 409);
      const codes = newRecoveryCodes();
      await tx.adminAuthenticator.update({
        where: { userId: user.id },
        data: { ...changes, recoveryHashes: JSON.stringify(codes.map(code => recoveryCodeHash(user.id, code))) },
      });
      return { recoveryCodes: codes };
    });
  }

  async disable(actor: AuthUser, input: Input, meta: Meta) {
    this.limit(actor, 'manage');
    return this.db.$transaction(async tx => {
      const { user, context, row } = await this.management(tx, actor, input);
      if (!row?.enabledAt) throw new BusinessException(ErrorCode.PARAM_INVALID, '管理员两步验证已停用', 409);
      await tx.adminAuthenticator.delete({ where: { userId: user.id } });
      return { session: await this.auth.rotateAdminSession(tx, user, context.familyId, meta, null, true) };
    });
  }
}
