import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {emailCodeMatches} from '../../common/security/email-code';
import { createHash, randomUUID } from 'node:crypto';
import { isEmail } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MailTemplateName, renderMail } from './mail.templates';
import { mailTransportConfiguration } from './mail-config';
import { classifyMailFailure, MAIL_TEMPLATES, RETRYABLE_MAIL_ERRORS, safeMailReceipt } from './mail-receipt';

type AttemptResult = { tried: boolean; status: string };

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly configuration = mailTransportConfiguration(process.env);
  private transporter: any = null;
  private timer?: NodeJS.Timeout;
  private retrying = false;
  private closing = false;
  private draining = false;
  private drainRequested = false;
  private readonly inFlight = new Map<string, Promise<AttemptResult>>();
  private readonly maxAttempts = 3;
  private readonly attemptDeadlineMs = 45_000;
  private readonly abandonedAfterMs = 300_000;
  private readonly retryIntervalMs = this.configuration.retryIntervalMs;

  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, @Optional() private readonly config?:ConfigService) {
    if (this.configuration.ready) {
      try {
        this.transporter = require('nodemailer').createTransport({ ...this.configuration.options, pool: true, maxConnections: 2, maxMessages: 100 });
        this.logger.log('发件设置已加载，实际投递仍需收件人验证');
      } catch { this.logger.warn('发件组件未就绪，仅保留投递记录'); }
    }
  }

  configurationSummary() {
    const { hostConfigured, senderConfigured, secure, requireTLS, authenticated, issues } = this.configuration;
    return { hostConfigured, senderConfigured, secure, requireTLS, authenticated, issues: [...issues], ready: !!this.transporter };
  }

  async prepare(template: MailTemplateName, data: Record<string, string>) {
    const siteName = await this.settings.get<string>('site.name');
    const rendered = renderMail(template, { ...data, siteName });
    return { subject: rendered.subject, template, payload: JSON.stringify(data), body: rendered.html,
      status: this.transporter ? 'queued' : 'skipped', error: this.transporter ? null : this.configuration.issues.length ? 'CONFIG_INVALID' : 'TRANSPORT_OFF' };
  }

  /** Persist first; neither registration nor password recovery waits for an SMTP server. */
  async send(template: MailTemplateName, to: string, data: Record<string, string>) {
    if (typeof to !== 'string' || to.length > 254 || /[\r\n]/.test(to) || !isEmail(to)) throw new Error('收件地址无效');
    const prepared = await this.prepare(template, data);
    const row = await this.prisma.mailOutbox.create({ data: { ...prepared, to } });
    if (row.status === 'queued') this.kick();
    return { id: row.id, status: row.status };
  }

  kick() {
    if (!this.transporter || this.closing) return;
    this.drainRequested = true;
    void this.drainQueued().catch(() => this.logger.warn('投递队列暂时不可用，将在下次检查时恢复'));
  }

  async onModuleInit() {
    await this.reconcileAbandoned();
    if (!this.transporter) {
      await this.prisma.mailOutbox.updateMany({ where: { status: 'queued' }, data: { status: 'skipped', error: this.configuration.issues.length ? 'CONFIG_INVALID' : 'TRANSPORT_OFF' } });
      return;
    }
    this.kick();
    if (Number.isFinite(this.retryIntervalMs) && this.retryIntervalMs > 0) {
      this.timer = setInterval(() => { void this.retryFailed().catch(() => this.logger.warn('定期投递检查暂时不可用')); }, this.retryIntervalMs);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.transporter?.close();
  }

  private async reconcileAbandoned() {
    await this.prisma.mailOutbox.updateMany({ where: { status: 'sending', lastTriedAt: { lte: new Date(Date.now() - this.abandonedAfterMs) } }, data: { status: 'unknown', error: 'RESULT_UNKNOWN' } });
  }

  retryScheduled(row: { status: string; attempts: number; error?: string | null }) {
    return !!this.transporter && Number.isFinite(this.retryIntervalMs) && this.retryIntervalMs > 0 && row.status === 'failed' && row.attempts < this.maxAttempts && RETRYABLE_MAIL_ERRORS.includes(row.error || '');
  }

  private async drainQueued() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.drainRequested && !this.closing) {
        this.drainRequested = false;
        const capacity = 2 - this.inFlight.size;
        if (capacity <= 0) continue;
        const rows = await this.prisma.mailOutbox.findMany({ where: { status: 'queued', attempts: { lt: this.maxAttempts }, id: { notIn: [...this.inFlight.keys()] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: capacity, select: { id: true } });
        for (const row of rows) void this.dispatch(row.id).catch(() => this.logger.warn('投递记录暂时无法更新'));
      }
    } finally { this.draining = false; }
  }

  private dispatch(id: string): Promise<AttemptResult> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    if (this.closing || !this.transporter || this.inFlight.size >= 2) return Promise.resolve({ tried: false, status: 'queued' });
    const task = this.attempt(id);
    this.inFlight.set(id, task);
    void task.then(result => { this.inFlight.delete(id); if (result.tried) this.kick(); }, () => { this.inFlight.delete(id); });
    return task;
  }

  private async attempt(id: string): Promise<AttemptResult> {
    const dispatchToken = randomUUID(), now = new Date();
    const claimed = await this.prisma.mailOutbox.updateMany({ where: { id, attempts: { lt: this.maxAttempts }, OR: [
      { status: 'queued' },
      { status: 'failed', error: { in: RETRYABLE_MAIL_ERRORS }, lastTriedAt: { lte: new Date(now.getTime() - Math.max(0, this.retryIntervalMs)) } },
    ] }, data: { status: 'sending', dispatchToken, attempts: { increment: 1 }, lastTriedAt: now, error: null } });
    if (!claimed.count) return { tried: false, status: (await this.prisma.mailOutbox.findUnique({ where: { id }, select: { status: true } }))?.status ?? 'unknown' };
    const row = await this.prisma.mailOutbox.findUniqueOrThrow({ where: { id } });
    const prepared = await this.renderOutbox(row);
    if (!prepared.ok) {
      await this.prisma.mailOutbox.updateMany({ where: { id, dispatchToken, status: 'sending' }, data: { status: 'suppressed', error: prepared.code } });
      return { tried: true, status: 'suppressed' };
    }
    // A lost acknowledgement after DATA cannot prove rejection. Preserve attempt ownership
    // so a late positive acknowledgement may still reconcile an uncertain receipt.
    const delivery = Promise.resolve().then(() => this.transporter.sendMail({ from: this.configuration.sender, to: row.to, ...prepared.rendered })).then(async info => {
      const accepted = Array.isArray(info?.accepted) && info.accepted.some((value: unknown) => typeof value === 'string' && value.toLowerCase() === row.to.toLowerCase());
      await this.prisma.mailOutbox.updateMany({ where: { id, dispatchToken, status: { in: ['sending', 'unknown'] } }, data: accepted
        ? { status: 'sent', error: null, sentAt: new Date(), subject: prepared.rendered.subject, body: prepared.rendered.html }
        : { status: 'unknown', error: 'RESULT_UNKNOWN' } });
    }, async error => {
      const result = classifyMailFailure(error);
      await this.prisma.mailOutbox.updateMany({ where: { id, dispatchToken, status: 'sending' }, data: { status: result.status, error: result.code } });
    }).catch(() => this.logger.warn('投递结果尚未写入，将保留未确认状态'));
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([delivery, new Promise<void>(resolve => {
        deadline = setTimeout(() => {
          void this.prisma.mailOutbox.updateMany({ where: { id, dispatchToken, status: 'sending' }, data: { status: 'unknown', error: 'RESULT_UNKNOWN' } }).catch(() => this.logger.warn('投递超时状态尚未保存')).finally(resolve);
        }, this.attemptDeadlineMs);
        deadline.unref();
      })]);
    } finally { if (deadline) clearTimeout(deadline); }
    return { tried: true, status: (await this.prisma.mailOutbox.findUnique({ where: { id }, select: { status: true } }))?.status ?? 'unknown' };
  }

  private async renderOutbox(row: { to: string; template: string; payload: string | null; requestedById: string | null }) {
    const invalid = (code: string) => ({ ok: false as const, code });
    if (!(MAIL_TEMPLATES as readonly string[]).includes(row.template) || /[\r\n]/.test(row.to) || !isEmail(row.to)) return invalid('DATA_INVALID');
    let data: Record<string, string>;
    try { data = JSON.parse(row.payload || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object' || Object.values(data).some(value => typeof value !== 'string')) return invalid('DATA_INVALID'); } catch { return invalid('DATA_INVALID'); }
    if(row.template==='emailVerification'){
      const proof=typeof data.challengeId==='string'?await this.prisma.emailVerification.findUnique({where:{id:data.challengeId}}):null;
      if(!proof||proof.email.toLowerCase()!==row.to.toLowerCase()||proof.usedAt||proof.attempts>=5||proof.expiresAt.getTime()<=Date.now()||!emailCodeMatches(this.config?.get<string>('JWT_SECRET')||process.env.JWT_SECRET||'',proof,data.code))return invalid('EMAIL_CODE_INACTIVE');
      if(proof.purpose==='ACCOUNT'){
        const user=proof.userId?await this.prisma.user.findUnique({where:{id:proof.userId}}):null;
        if(!user||user.deletedAt||user.status!=='ACTIVE'||user.tokenVersion!==proof.tokenVersion||user.email!==proof.email||user.emailVerifiedAt||row.requestedById!==user.id)return invalid('EMAIL_CODE_INACTIVE');
      }else if(proof.purpose!=='REGISTER'||proof.userId||proof.tokenVersion!==null)return invalid('EMAIL_CODE_INACTIVE');
    } else if (row.template === 'resetPassword') {
      let url: URL, origin: URL;
      try { url = new URL(data.resetUrl); origin = new URL(await this.settings.get<string>('site.baseUrl')); } catch { return invalid('RESET_INACTIVE'); }
      const token = url.searchParams.get('token');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== origin.origin || !token || !/^[a-f\d]{48}$/i.test(token)) return invalid('RESET_INACTIVE');
      const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
      if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) return invalid('RESET_INACTIVE');
      const user = await this.prisma.user.findUnique({ where: { id: reset.userId } });
      if (!user || user.deletedAt || user.status !== 'ACTIVE' || user.email.toLowerCase() !== row.to.toLowerCase()) return invalid('RESET_INACTIVE');
    } else {
      const user = await this.prisma.user.findFirst({ where: { ...(row.requestedById ? { id: row.requestedById } : { email: row.to }), deletedAt: null, status: 'ACTIVE' } });
      if (!user || user.email.toLowerCase() !== row.to.toLowerCase()) return invalid('DATA_INVALID');
    }
    try { return { ok: true as const, rendered: renderMail(row.template as MailTemplateName, { ...data, siteName: await this.settings.get<string>('site.name') }) }; }
    catch { return invalid('DATA_INVALID'); }
  }

  async retryFailed(limit = 20) {
    if (!this.transporter || this.retrying || this.closing) return { tried: 0, sent: 0, failed: 0 };
    this.retrying = true;
    const result = { tried: 0, sent: 0, failed: 0 };
    try {
      await this.reconcileAbandoned();
      this.kick();
      const rows = await this.prisma.mailOutbox.findMany({ where: { status: 'failed', attempts: { lt: this.maxAttempts }, error: { in: RETRYABLE_MAIL_ERRORS }, lastTriedAt: { lte: new Date(Date.now() - Math.max(0, this.retryIntervalMs)) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 20)), select: { id: true } });
      for (const row of rows) { const attempt = await this.dispatch(row.id); if (attempt.tried) { result.tried++; if (attempt.status === 'sent') result.sent++; else result.failed++; } }
      return result;
    } finally { this.retrying = false; }
  }

  async outbox(page = 1, pageSize = 20, filters: { status?: string; template?: string; keyword?: string } = {}) {
    page = Math.min(1_000_000, Math.max(1, Number.isSafeInteger(page) ? page : 1));
    pageSize = Math.min(100, Math.max(1, Number.isSafeInteger(pageSize) ? pageSize : 20));
    const where = { ...(filters.status ? { status: filters.status } : {}), ...(filters.template ? { template: filters.template } : {}), ...(filters.keyword ? { to: { contains: filters.keyword } } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mailOutbox.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, to: true, template: true, status: true, error: true, attempts: true, createdAt: true, sentAt: true, lastTriedAt: true, confirmedAt: true } }),
      this.prisma.mailOutbox.count({ where }),
    ]);
    return { items: items.map(safeMailReceipt), total, page, pageSize };
  }
}
