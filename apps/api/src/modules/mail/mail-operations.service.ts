import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { SettingsService } from '../settings/settings.service';
import { MailService } from './mail.service';
import { MAIL_STATES, maskedMailbox, safeMailReceipt } from './mail-receipt';
import { MailTemplateName, renderMail } from './mail.templates';

@Injectable()
export class MailOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly settings: SettingsService, private readonly rate: RateLimitService) {}

  private probeReceipt(row: Parameters<typeof safeMailReceipt>[0]) {
    return { ...safeMailReceipt(row), canConfirm: ['sent', 'unknown'].includes(row.status), retryScheduled: this.mail.retryScheduled(row) };
  }

  private async siteReady() {
    try {
      const value = await this.settings.get<string>('site.baseUrl'), url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && value === url.origin;
    } catch { return false; }
  }

  async status(userId: string) {
    const [user, counts, recent, siteReady] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
      this.prisma.mailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.mailOutbox.findFirst({ where: { requestedById: userId, template: 'deliveryProbe' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.siteReady(),
    ]);
    const configuration = this.mail.configurationSummary();
    return { operatorMailbox: user.email ? maskedMailbox(user.email) : null, counts: Object.fromEntries(MAIL_STATES.map(status => [status, counts.find(row => row.status === status)?._count._all ?? 0])), recentProbe: recent ? this.probeReceipt(recent) : null,
      transport: { canTest: configuration.ready && siteReady && !!user.email, checks: [
        {id:'recipient',title:'体验信收件地址',ready:!!user.email,description:user.email?'将寄送到当前管理员的邮箱。':'当前管理员尚未设置邮箱，暂时不能寄送体验信。'},
        { id: 'sender', title: '发件账户与地址', ready: configuration.ready, description: configuration.ready ? '已加载可尝试投递的发件设置，仍需验证实际收信。' : configuration.issues.length ? '设置未完整加载，请由部署负责人核对发件配置。' : '尚未启用发件，请由部署负责人准备发件账户。' },
        { id: 'encryption', title: '邮件连接方式', ready: configuration.ready && (configuration.secure || configuration.requireTLS), description: configuration.secure || configuration.requireTLS ? '已要求加密连接；能否建立连接以实际投递为准。' : '尚未要求加密连接。生产站点需要启用加密后再开放。' },
        { id: 'origin', title: '站点与返回地址', ready: siteReady, description: siteReady ? '已填写站点地址。请继续验证找回密码链接是否能正确返回。' : '请先在站点设置中填写正确的访问地址。' },
      ] } };
  }

  async createProbe(userId: string, requestKey: string, ip: string) {
    const prepared = await this.mail.prepare('deliveryProbe', { username: '朋友' });
    const siteReady = await this.siteReady();
    const row = await this.prisma.$transaction(async tx => {
      // A write reservation precedes reads, so separate processes cannot exceed the account quota.
      const actor = await tx.user.updateMany({ where: { id: userId, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, data: { tokenVersion: { increment: 0 } } });
      if (!actor.count) throw new ForbiddenException('当前账户不能发送体验信');
      const prior = await tx.mailOutbox.findUnique({ where: { requestedById_requestKey: { requestedById: userId, requestKey } } });
      if (prior) return prior;
      if (!this.mail.configurationSummary().ready || !siteReady || prepared.status !== 'queued') throw new ServiceUnavailableException('请先准备好发件设置与站点地址');
      const count = await tx.mailOutbox.count({ where: { requestedById: userId, template: 'deliveryProbe', createdAt: { gte: new Date(Date.now() - 900_000) } } });
      if (count >= 3 || !this.rate.tryConsume('mail-probe:' + ip, 10, 900_000)) throw new HttpException('发送较频繁，请稍后再试', 429);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if(!user.email)throw new ServiceUnavailableException('当前账户尚未设置邮箱，暂时不能寄送体验信');
      return tx.mailOutbox.create({ data: { ...prepared, to: user.email, requestedById: userId, requestKey } });
    });
    this.mail.kick();
    return this.probeReceipt(row);
  }

  async probe(userId: string, requestKey: string) {
    const row = await this.prisma.mailOutbox.findFirst({ where: { requestedById: userId, requestKey, template: 'deliveryProbe' } });
    if (!row) throw new NotFoundException('没有找到这次体验信请求，请稍后再次核对');
    return this.probeReceipt(row);
  }

  async confirm(userId: string, id: string) {
    const row = await this.prisma.mailOutbox.findFirst({ where: { id, requestedById: userId, template: 'deliveryProbe' } });
    if (!row) throw new NotFoundException('没有找到这封体验信');
    if (!['sent', 'unknown'].includes(row.status)) throw new ConflictException('请先等待投递结果，再确认收信');
    await this.prisma.mailOutbox.updateMany({ where: { id, requestedById: userId, confirmedAt: null, status: { in: ['sent', 'unknown'] } }, data: { confirmedAt: new Date() } });
    return this.probeReceipt(await this.prisma.mailOutbox.findUniqueOrThrow({ where: { id } }));
  }

  templates() {
    const titles: Record<MailTemplateName, string> = { welcome: '欢迎信', resetPassword: '找回密码', deliveryProbe: '体验信', emailVerification:'邮箱验证码' };
    return (Object.keys(titles) as MailTemplateName[]).map(id => {
      const rendered = renderMail(id, { siteName: 'QGauss AI', username: '灵感朋友', code:'000000', purpose:'确认注册邮箱', resetUrl: 'https://example.invalid/reset-password?token=preview-only' });
      return { id, title: titles[id], html: rendered.html.replace(/<a\b[^>]*>(.*?)<\/a>/gs, '<span>$1</span>'), text: rendered.text };
    });
  }
}
