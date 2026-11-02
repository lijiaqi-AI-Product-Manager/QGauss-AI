import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { passwordProblem } from '../../common/security/password-policy';

/** A repeat seed preserves an existing administrator; it never promotes or reactivates a member. */
export async function seedAdministrator(prisma: PrismaClient, input: { email: string; username: string; password: string }) {
  if (passwordProblem(input.password)) throw new Error('SEED_ADMIN_PASSWORD 需为 8–32 字符且不超过 72 个 UTF-8 字节；生产规则另行校验');
  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO global_configs (key,value,updatedAt) VALUES ('installation.state',${JSON.stringify({ version: 1, phase: 'legacy' })},${new Date()}) ON CONFLICT(key) DO UPDATE SET key=excluded.key`;
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.role !== 'ADMIN' || existing.status !== 'ACTIVE' || existing.deletedAt) throw new Error('种子管理员邮箱已被其他或停用账户占用，不会提升权限或重新启用');
      return existing;
    }
    if (await tx.user.count()) throw new Error('站点已有账户，不会额外创建默认管理员；请使用现有管理员或执行受控恢复');
    const admin = await tx.user.create({ data: { email: input.email, username: input.username, passwordHash, displayName: '管理员', role: 'ADMIN' } });
    await tx.globalConfig.update({ where: { key: 'installation.state' }, data: { value: JSON.stringify({ version: 1, phase: 'legacy' }) } });
    return admin;
  });
}
