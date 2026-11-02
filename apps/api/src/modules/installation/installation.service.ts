import { ConflictException, ForbiddenException, Injectable, OnModuleInit, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { passwordProblem } from '../../common/security/password-policy';
import { SettingsService } from '../settings/settings.service';
import { ModelCatalogService } from '../models/model-catalog.service';
import { modelCapabilities } from '../models/model-capabilities';
import { InitializeDto } from './installation.dto';
import { bootstrapMenu } from './bootstrap-menu';
import { MailOperationsService } from '../mail/mail-operations.service';

const STATE_KEY = 'installation.state';
const DEMO_MODEL = 'qgauss-demo-chat';
const DEMO_CHANNEL = 'QGauss 本地体验';
type InstallationState = { version: 1; phase: 'required' | 'complete' | 'legacy'; completedAt?: string; adminId?: string; requestKey?: string; requestFingerprint?: string };

export function isLoopbackAddress(address = '') {
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  return value === '::1' || isIP(value) === 4 && value.split('.')[0] === '127';
}

@Injectable()
export class InstallationService implements OnModuleInit {
  private closed: InstallationState | null = null;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly settings: SettingsService, private readonly catalog: ModelCatalogService, private readonly mail: MailOperationsService) {}

  async onModuleInit() {
    const state = await this.currentState();
    if (this.config.get('NODE_ENV') !== 'production') return;
    if (state.phase === 'required' && !this.config.get('QGAUSS_SETUP_TOKEN')) throw new Error('新站点必须配置独立的 QGAUSS_SETUP_TOKEN，再通过安装页创建管理员');
    if (state.phase !== 'required' && !await this.prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } })) throw new Error('站点已有历史账户但没有可用管理员，请执行受控账户恢复；不会重新开放安装入口');
  }

  private remember(state: InstallationState) {
    if (state.phase !== 'required' && !this.closed) { this.closed = state; this.settings.invalidateAll(); }
    return state;
  }

  private async lockedState(tx: Prisma.TransactionClient): Promise<InstallationState> {
    // Acquire SQLite's write reservation before any read, including across application processes.
    await tx.$executeRaw`INSERT INTO global_configs (key,value,updatedAt) VALUES (${STATE_KEY},${JSON.stringify({ version: 1, phase: 'required' })},${new Date()}) ON CONFLICT(key) DO UPDATE SET key=excluded.key`;
    const row = await tx.globalConfig.findUniqueOrThrow({ where: { key: STATE_KEY } });
    let state: InstallationState;
    try {
      state = JSON.parse(row.value);
      if (state?.version !== 1 || !['required', 'complete', 'legacy'].includes(state.phase)) throw new Error();
      if (state.phase === 'complete' && (!state.adminId || !state.requestKey || !state.requestFingerprint || !state.completedAt)) throw new Error();
    } catch { throw new ServiceUnavailableException('安装记录异常，请由部署负责人检查；初始化入口保持关闭'); }
    if (state.phase === 'required' && await tx.user.count()) {
      state = { version: 1, phase: 'legacy' };
      await tx.globalConfig.update({ where: { key: STATE_KEY }, data: { value: JSON.stringify(state) } });
    }
    return state;
  }

  async currentState() {
    if (this.closed) return this.closed;
    return this.remember(await this.prisma.$transaction(tx => this.lockedState(tx)));
  }

  async isRequired() { return (await this.currentState()).phase === 'required'; }

  async status(secureConnection: boolean) {
    const required = await this.isRequired();
    const needsSecureConnection = required && this.config.get('NODE_ENV') === 'production' && !secureConnection;
    return { required, canInitialize: required && !!this.config.get('QGAUSS_SETUP_TOKEN') && !needsSecureConnection, needsSecureConnection };
  }

  assertOwner(provided: unknown, secureConnection: boolean) {
    const expected = this.config.get<string>('QGAUSS_SETUP_TOKEN');
    if (!expected || typeof provided !== 'string' || provided.length > 128
      || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(provided).digest())) throw new ForbiddenException('安装凭证无效或初始化不可用');
    if (this.config.get('NODE_ENV') === 'production' && !secureConnection) throw new ForbiddenException('请通过安全连接或本机完成初始化');
  }

  async initialize(dto: InitializeDto) {
    const problem = passwordProblem(dto.password, true);
    if (problem) throw new UnprocessableEntityException(problem);
    let origin: URL;
    try {
      origin = new URL(dto.siteBaseUrl);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== dto.siteBaseUrl) throw new Error();
      if (this.config.get('NODE_ENV') === 'production' && origin.protocol !== 'https:' && !isLoopbackAddress(origin.hostname.replace(/^\[|\]$/g, '')) && origin.hostname !== 'localhost') throw new Error();
    } catch { throw new UnprocessableEntityException('站点地址只接受完整来源；生产站点须使用 HTTPS，本机地址除外'); }
    const payload = { email: dto.email.trim().toLowerCase(), username: dto.username, displayName: dto.displayName?.trim() || dto.username, password: dto.password, siteBaseUrl: origin.origin, openRegistration: dto.openRegistration };
    const requestFingerprint = createHmac('sha256', this.config.get<string>('QGAUSS_SETUP_TOKEN') || '').update(JSON.stringify(payload)).digest('hex');
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const result = await this.prisma.$transaction(async tx => {
      const state = await this.lockedState(tx);
      if (state.phase !== 'required') return { state, confirmed: state.phase === 'complete' && state.requestKey === dto.requestKey && state.requestFingerprint === requestFingerprint };
      const admin = await tx.user.create({ data: { email: payload.email, username: payload.username, displayName: payload.displayName, passwordHash, role: 'ADMIN' } });
      for (const [key, value] of Object.entries({ 'site.name': 'QGauss AI', 'site.baseUrl': payload.siteBaseUrl, 'security.registerEnabled': payload.openRegistration, 'commerce.enabled': false })) {
        await tx.globalConfig.upsert({ where: { key }, create: { key, value: JSON.stringify(value), updatedBy: admin.id }, update: { value: JSON.stringify(value), updatedBy: admin.id } });
      }
      await bootstrapMenu(tx);
      const completed: InstallationState = { version: 1, phase: 'complete', adminId: admin.id, completedAt: new Date().toISOString(), requestKey: dto.requestKey, requestFingerprint };
      await tx.globalConfig.update({ where: { key: STATE_KEY }, data: { value: JSON.stringify(completed), updatedBy: admin.id } });
      return { state: completed, confirmed: true };
    });
    this.remember(result.state);
    if (!result.confirmed) throw new ConflictException('站点已经关闭初始化入口，请前往登录确认');
    return { initialized: true, next: '/login?redirect=/welcome' };
  }

  async readiness(userId: string) {
    const [user, catalog, commerce, mailStatus, firstChat, firstImage] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }), this.catalog.available(),
      this.settings.get<boolean>('commerce.enabled'), this.mail.status(userId),
      this.prisma.message.count({ where: { role: 'ASSISTANT', status: 'COMPLETED', conversation: { userId } } }),
      this.prisma.imageTask.count({ where: { userId, status: 'SUCCESS', deletedAt: null } }),
    ]);
    const readyChat = catalog.filter(model => model.ready && !(model.capabilities.includes('image') && !model.capabilities.includes('chat')));
    const chat = readyChat[0];
    const demo = chat ? await this.prisma.modelChannel.count({ where: { modelId: chat.id, enabled: true, channel: { type: { not: 'MOCK' }, status: 'ENABLED', deletedAt: null } } }) === 0 : false;
    const defaultPassword = await bcrypt.compare('admin123456', user.passwordHash);
    const mailConfigured = mailStatus.transport.canTest;
    return {
      canEnableDemo: readyChat.length === 0,
      chatModel: chat ? { name: chat.name, displayName: chat.displayName, demo, billing: chat.billing } : null,
      checks: [
        { id: 'account', state: defaultPassword ? 'action' : 'ready', title: '守好空间的第一把钥匙', description: defaultPassword ? '当前管理员仍使用开发演示默认密码，请先修改，再开放站点。' : '当前管理员未使用开发演示默认密码。历史密码强度无法从保存记录中判断，可随时更换独立密码。', action: { label: '查看账户与密码', path: '/account?section=security' } },
        { id: 'model', state: chat ? 'configured' : 'missing', title: '让一位创作搭档就位', description: chat ? `${chat.displayName} 已有启用配置${demo ? '，属于本地演示，不连接真实模型' : '，仍需验证真实回答与速度'}。` : '还没有可用的对话模型。连接渠道并绑定模型，或明确开启本地体验。', action: { label: chat ? '查看模型配置' : '连接模型服务', path: chat ? '/models/list' : '/models/channels' } },
        { id: 'mail', state: mailStatus.recentProbe?.confirmedAt ? 'ready' : mailConfigured ? 'configured' : 'optional', title: '为账户留一条返回的路', description: mailStatus.recentProbe?.confirmedAt ? '你已确认收到最近的体验信。开放给用户前，还需验证找回密码链接。' : mailConfigured ? '发件与站点设置已加载，前往邮件中心验证实际收信，再核对密码重置链接。' : '尚未完成发件配置。开放给其他用户前，请由部署负责人配置邮件并验证找回密码。', action: { label: '打开邮件中心', path: '/mail' } },
        { id: 'creation', state: firstChat + firstImage > 0 ? 'ready' : 'action', title: '留下你的第一份创作', description: firstChat + firstImage > 0 ? '此账号已有保存完成的对话或绘画结果。演示结果不代表真实模型验收完成。' : '此账号尚无完成的对话或绘画。打开工作区，准备好内容后再明确生成。', action: { label: '打开创作工作区', path: chat ? '/chat?model=' + encodeURIComponent(chat.name) : '/chat' } },
        { id: 'opening', state: commerce ? 'configured' : 'optional', title: '按准备程度，决定开放节奏', description: commerce ? '商业化开关已开启，不代表真实付款、退款和对账已验证。收费前请完成全流程核对。' : '商业化保持关闭。你可以先验证创作体验，再考虑套餐与收付款。', action: { label: '查看开放设置', path: '/settings' } },
      ],
    };
  }

  async enableDemo() {
    await this.prisma.$transaction(async tx => {
      const state = await this.lockedState(tx);
      if (state.phase === 'required') throw new ConflictException('请先完成初始化');
      const existing = await tx.aiModel.findUnique({ where: { name: DEMO_MODEL }, include: { channels: { include: { channel: true } } } });
      if (existing) {
        if (existing.status === 'ENABLED' && !existing.deletedAt && existing.channels.some(binding => binding.enabled && binding.channel.name === DEMO_CHANNEL && binding.channel.type === 'MOCK' && binding.channel.status === 'ENABLED' && !binding.channel.deletedAt)) return;
        throw new ConflictException('本地体验名称已存在，请在模型管理中核对，不会覆盖原配置');
      }
      const models = await tx.aiModel.findMany({ where: { status: 'ENABLED', deletedAt: null, channels: { some: { enabled: true, channel: { status: 'ENABLED', deletedAt: null } } } } });
      if (models.some(model => !(modelCapabilities(model.capabilities).includes('image') && !modelCapabilities(model.capabilities).includes('chat')))) throw new ConflictException('已有可用对话模型，请直接在工作区选择');
      if (await tx.channel.findUnique({ where: { name: DEMO_CHANNEL } })) throw new ConflictException('本地体验渠道名称已存在，请先核对原配置');
      const channel = await tx.channel.create({ data: { name: DEMO_CHANNEL, type: 'MOCK', baseUrl: 'mock://local' } });
      const model = await tx.aiModel.create({ data: { name: DEMO_MODEL, displayName: DEMO_CHANNEL, vendor: 'QGauss', description: '离线操作演示，不代表真实模型能力。', capabilities: 'chat', countPool: '', countCost: 0 } });
      await tx.modelChannel.create({ data: { modelId: model.id, channelId: channel.id, upstreamName: DEMO_MODEL } });
    });
    return { enabled: true, model: DEMO_MODEL };
  }
}
