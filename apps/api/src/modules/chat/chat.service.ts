import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {accessibleAppWhere} from '../apps/app-visibility';
import { ModelsService, ResolvedChannel } from '../models/models.service';
import { KeyPoolService } from '../models/key-pool.service';
import { AttachmentsService, ResolvedMessage } from './attachments.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { safeFetch } from '../../common/net/safe-fetch';
import { classifyFailure } from '../../common/llm/classify';
import { BreakerRegistry } from '../../common/llm/breaker';
import { truncateContext } from '../../common/llm/context';
import { QuotaService } from './quota.service';
import { ModerationService } from '../moderation/moderation.service';
import { AppsService } from '../apps/apps.service';
import { RateLimitService } from '../../common/ratelimit/rate-limit.service';
import { chatCharge } from '../commerce/chat-pricing';
import { ChatAccountingService, messageBilling } from './chat-accounting.service';
import { ChatCompletionDto } from './dto/chat.dto';
import { ChatRun } from './chat-run';
import { modelCapabilities } from '../models/model-capabilities';
import { buildChatRequest, ProtocolUsage, UpstreamError } from '../../common/llm/chat-protocol';
import { readChatResponse } from '../../common/llm/chat-stream';
import { safeWebSearch } from '../../common/llm/web-search';
import { publicAgentActivity, safeAgentActivity } from '../../common/llm/agent-activity';
import { AgentsService } from '../agents/agents.service';
import { AgentExecutionService } from '../agents/agent-execution.service';
import {ExtensionsService} from '../extensions/extensions.service';

type MsgStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'ABORTED' | 'FAILED';

@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private readonly active = new Map<string, number>();
  private sweeper?: NodeJS.Timeout;
  private readonly runs = new Map<string, ChatRun>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
    private readonly settings: SettingsService,
    private readonly breakers: BreakerRegistry,
    private readonly quota: QuotaService,
    private readonly moderation: ModerationService,
    private readonly apps: AppsService,
    private readonly rateLimit: RateLimitService,
    private readonly accounting: ChatAccountingService,
    private readonly keyPool: KeyPoolService,
    private readonly attachments: AttachmentsService,
    @Optional() private readonly agents?:AgentsService,
    @Optional() private readonly agentExecution?:AgentExecutionService,
    @Optional() private readonly extensions?:ExtensionsService,
  ) {}

  /**
   * 解析本次请求要扣的次数。
   * 返回 null = 不扣费（演示站 / 未启用商业化 / 模型没有配次数池）。
   *
   * 为什么按「次数」而不是按 token 折钱：钱包是整数分，而单条对话的成本
   * 常年在 0.1 分以下，向上取整会变成 1 分，直接放大十倍以上。
   * 所以给模型配一个次数池 + 每次消耗次数。
   */
  private async resolveCharge(model: any, demoMode: boolean) {
    if (demoMode) return null;
    const enabled = await this.settings.get<boolean>('commerce.enabled');
    if (!enabled) return null;

    return chatCharge(model, enabled, demoMode);
  }

  async onModuleInit() {
    await this.sweepStuck(true);
    // Saved output retries settlement; interrupted generation releases its accepted reservation.
    this.sweeper = setInterval(() => {
      this.sweepStuck().catch((e) => this.logger.error(`sweeper failed: ${e.message}`));
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const run of this.runs.values()) run.cancel('server_shutdown');
  }

  private async sweepStuck(startup = false) {
    const cutoff = new Date(Date.now() - 120_000);
    const messages = await this.prisma.message.findMany({
      where: {
        role: 'ASSISTANT',
        OR: [{ status: 'SETTLING' }, { status: { in: ['PENDING', 'STREAMING'] }, ...(startup ? {} : { updatedAt: { lt: cutoff } }) }],
        id: { notIn: [...this.runs.keys()] },
      },
      select: { id: true },
    });
    for (const message of messages) {
      try { await this.accounting.recover(message.id);await this.agentExecution?.recover(message.id); }
      catch (error) { this.logger.error(`回复结算待重试 ${message.id}: ${(error as Error).message}`); }
    }
  }

  private writeEvent(res: Response | ChatRun, event: string, data: unknown) {
    if (res instanceof ChatRun) { res.emit(event, data); return; }
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* 连接已断开 */
    }
  }

  private estimateTokens(text: string) {
    if (!text) return 0;
    // 中英混合的粗略估算：约 3 字符 / token
    return Math.max(1, Math.ceil(text.length / 3));
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------------------------------------------------------------- 主流程

  async completions(userId: string, dto: ChatCompletionDto, res: Response) {
    if (dto.extensionRequestKey && this.extensions) {
      const accepted = await this.extensions.acceptedChat(userId, dto);
      if (accepted) return this.events(userId, accepted, 0, res);
    }
    const maxStreams = await this.settings.get<number>('chat.maxConcurrentStreams');
    const current = this.active.get(userId) ?? 0;
    if (current >= maxStreams) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '并发请求过多，请稍后再试', 429);
    }
    this.active.set(userId, current + 1);

    try {
      await this.run(userId, dto, res);
    } finally {
      const left = (this.active.get(userId) ?? 1) - 1;
      if (left <= 0) this.active.delete(userId);
      else this.active.set(userId, left);
    }
  }

  private openSse(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  }

  private async ownedRunMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, role: 'ASSISTANT', deletedAt: null, conversation: { userId, deletedAt: null } },
      include: { conversation: { select: { title: true, model: { select: { maxContext: true } } } }, agentRun:{select:{cancelState:true}} },
    });
    if (!message) throw new BusinessException(ErrorCode.NOT_FOUND, '消息不存在', 404);
    return message;
  }

  async events(userId: string, messageId: string, after: number | null, res: Response) {
    let message = await this.ownedRunMessage(userId, messageId);
    const run = this.runs.get(messageId);
    if (run && run.userId === userId) { run.subscribe(res, after); return; }
    // A fresh committed admission may not have registered its in-memory run yet.
    // Startup recovers old process rows; only old orphan rows are failed here.
    if (message.status === 'SETTLING' || (['PENDING', 'STREAMING'].includes(message.status) && message.updatedAt.getTime() < Date.now() - 120_000)) {
      await this.accounting.recover(messageId).catch(error => this.logger.warn(`回复结算待重试 ${messageId}: ${error.message}`));
      await this.agentExecution?.recover(messageId);
      message = await this.ownedRunMessage(userId, messageId);
    }
    this.openSse(res);
    const billing = messageBilling(message);
    const snapshot = { messageId, conversationId: message.conversationId, userMessageId: message.parentId, model: message.modelName, title: message.conversation.title, content: message.content, reasoning: message.reasoning || '', status: message.status, finishReason: message.finishReason, errorCode: message.errorCode, promptTokens: message.promptTokens, completionTokens: message.completionTokens, usageEstimated: message.usageEstimated, contextLimit: message.conversation.model?.maxContext ?? null, billing, charged: billing?.charged ? { pool: billing.pool, amount: billing.charged } : null };
    res.end('id: ' + (after ?? 0) + '\nevent: snapshot\ndata: ' + JSON.stringify({...snapshot,...(safeWebSearch(message.searchJson)?{webSearch:safeWebSearch(message.searchJson)}:{}),...(publicAgentActivity(message.agentJson,message.agentRun)?{agentActivity:publicAgentActivity(message.agentJson,message.agentRun)}:{})}) + '\n\n');
  }

  async cancel(userId: string, messageId: string) {
    const message = await this.ownedRunMessage(userId, messageId);
    const run = this.runs.get(messageId);
    if (run && run.userId === userId) return { messageId, cancelRequested: run.cancel(), status: 'RUNNING' };
    return { messageId, cancelRequested: false, status: message.status };
  }

  cancelConversationRuns(userId: string, conversationId: string, messageId?: string) {
    for (const run of this.runs.values()) if (run.userId === userId && run.conversationId === conversationId && (!messageId || run.messageId === messageId)) run.cancel('resource_deleted');
  }

  private async run(userId: string, dto: ChatCompletionDto, res: Response) {
    const chatLimit = await this.settings.get<number>('security.chatRateLimit');
    if (!this.rateLimit.tryConsume(`chat:${userId}`, chatLimit, 60_000)) {
      throw new BusinessException(ErrorCode.RATE_LIMITED, '请求过于频繁，请稍后再试', 429);
    }

    await this.quota.assertWithinQuota(userId);

    // 先核对归属，再沿用会话已保存的应用，避免重开历史时丢失角色设定。
    let conversation = dto.conversationId
      ? await this.prisma.conversation.findFirst({ where: { id: dto.conversationId, userId, deletedAt: null }, include: { model: { select: { name: true } } } })
      : null;
    if (dto.conversationId && !conversation) throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在', 404);
    if(dto.extensionRequestKey&&!this.extensions)throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'扩展对话暂未准备好。',503);
    const extensionAdmission=dto.extensionRequestKey?await this.extensions!.authorizeChat(userId,dto):null;
    if(!dto.extensionRequestKey&&conversation?.params?.includes('"extensionRequestKey"'))await this.extensions?.requireInitialRequestKey(userId,conversation.id);
    if (conversation && dto.appId && dto.appId !== conversation.appId) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '当前会话的应用不可切换，请新建对话', 400);
    }
    if(conversation&&dto.agentId&&dto.agentId!==conversation.agentId)throw new BusinessException(ErrorCode.PARAM_INVALID,'当前会话的搭档不可切换，请新建协作',400);
    const agentId=conversation?.agentId||dto.agentId;
    if(agentId&&(dto.appId||conversation?.appId||dto.webSearch||dto.model||dto.temperature!==undefined||dto.maxTokens!==undefined))throw new BusinessException(ErrorCode.PARAM_INVALID,'智能体由搭档自身配置模型与工具，请通过搭档入口发送',400);
    if(!agentId&&(dto.agentParentId||dto.agentOfferRevision))throw new BusinessException(ErrorCode.PARAM_INVALID,'当前请求未选择智能体搭档',400);
    const agent=agentId&&this.agents?await this.agents.resolveForChat(agentId,dto.agentOfferRevision):null;
    if(agentId&&(!agent||!this.agentExecution))throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'智能体协作尚未就绪',503);

    // ---- 应用（智能体）：决定模型与 system prompt ----
    const appId = conversation?.appId || dto.appId;
    const app = appId ? await this.apps.getForChat(appId,userId) : null;
    if(app&&dto.appVersion!==undefined&&dto.appVersion!==app.version)throw new BusinessException(ErrorCode.PARAM_INVALID,'应用设定已变化，请重新打开并核对',409);
    const modelName =
      extensionAdmission?.modelName || dto.model ||
      conversation?.model?.name ||
      app?.defaultModel ||
      (await this.settings.get<string>('chat.defaultModel'));

    const lastRequestedUser=[...dto.messages].reverse().find(message=>message.role==='user');
    const requestedMessages=dto.webSearch?[...dto.messages.filter(message=>message.role==='system'),...(lastRequestedUser?[lastRequestedUser]:[])]:dto.messages;
    const chatMessages = app
      ? [
          { role: 'system' as const, content: app.systemPrompt },
          ...requestedMessages.filter((m) => m.role !== 'system'),
        ]
      : requestedMessages;

    // ---- 演示站模式：不调用上游，直接走本地演示流 ----
    const demoMode = extensionAdmission?extensionAdmission.demoMode:await this.settings.get<boolean>('demo.siteEnabled');

    let model: any;
    let channels: any[];

    if(agent){model=agent.model;channels=[];}
    else if (demoMode) {
      model = {
        id: 'demo',
        name: dto.model || 'demo',
        maxContext: 8192,
        maxOutput: 1024,
        priceInPerM: 0,
        priceOutPerM: 0,
      };
      channels = [
        {
          id: 'demo',
          name: 'demo',
          type: 'DEMO',
          baseUrl: 'demo://local',
          apiKey: '',
          timeoutMs: 5000,
          priority: 0,
          weight: 1,
          upstreamName: 'demo',
        },
      ];
    } else {
      const route = await this.models.resolveRoute(modelName);
      model = route.model;
      const capabilities = modelCapabilities(model.capabilities);
      if (capabilities.includes('image') && !capabilities.includes('chat')) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '此模型用于图像创作，请到绘画工作台使用', 400);
      }
      // 熔断中的渠道直接跳过
      channels = route.channels.filter((c) => this.breakers.isAvailable(c.id));
      if (channels.length === 0) {
        throw new BusinessException(
          ErrorCode.CHANNEL_UNAVAILABLE,
          '所有渠道暂不可用，请稍后重试',
          503,
        );
      }
    }

    if(dto.webSearch){
      if(demoMode||!modelCapabilities(model.capabilities).includes('web_search'))throw new BusinessException(ErrorCode.PARAM_INVALID,'当前模型尚未配置联网检索',400);
      channels=channels.filter((channel:ResolvedChannel)=>!!channel.webSearchMode);
      if(!channels.length)throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE,'当前模型没有支持联网的可用渠道，请更换模型或关闭联网',400);
    }
    // ---- 商业化：接受费用快照；在消息事务内原子预留 ----
    const charge = agent?chatCharge(model,agent.commerceEnabled,false):extensionAdmission?extensionAdmission.charge:await this.resolveCharge(model, demoMode);

    // ---- 会话 ----
    const newConversation = !conversation;
    // Keep the proposed identity local until messages and authorization can commit together.
    if (!conversation) conversation = { id: randomUUID(), title: '新对话', modelId: demoMode ? null : model.id } as NonNullable<typeof conversation>;
    const conversationId = conversation.id;

    const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser) throw new BusinessException(ErrorCode.PARAM_INVALID, '缺少用户消息');

    // ---- 敏感词拦截（在落库之前，避免脏数据）----
    const hit = await this.moderation.check(lastUser.content);
    if (hit?.action === 'block') {
      await this.moderation.recordHit({
        userId,
        word: hit.word,
        source: 'chat',
        excerpt: lastUser.content,
        conversationId: newConversation ? undefined : conversationId,
      });
      const masked = `${hit.word.slice(0, 1)}${'*'.repeat(Math.max(1, hit.word.length - 1))}`;
      throw new BusinessException(
        ErrorCode.CONTENT_BLOCKED,
        `内容包含敏感词「${masked}」，已被拦截`,
        400,
      );
    }

    // ---- 附件：文档解析并入上下文，最后一条用户消息里的图片交给识图模型 ----
    const vision = demoMode || String(model.capabilities ?? '').split(',').includes('vision');
    const nativeInput=agent?await this.agentExecution!.validateInput(userId,chatMessages):null;
    const { messages: upstreamMessages, lastUserAttachments } = nativeInput?{messages:nativeInput.input,lastUserAttachments:nativeInput.lastUserAttachments}:this.attachments.hasAttachments(chatMessages)
      ? await this.attachments.resolve(userId, chatMessages, { vision })
      : {
          messages: chatMessages.map((m): ResolvedMessage => ({ role: m.role, content: m.content })),
          lastUserAttachments: [],
        };

    // ---- 会话标题（首条消息自动命名；从应用进入则用应用名）----
    let title = conversation.title;
    if (!title || title === '新对话') {
      title = agent?.agent.name || app?.name || lastUser.content.replace(/\s+/g, ' ').slice(0, 24) || '新对话';
      if (!newConversation) await this.prisma.conversation.update({ where: { id: conversationId }, data: { title } });
    }

    // ---- 用户消息（clientMsgId 幂等；重新生成时复用原消息，不新增）----
    let userMsg: any = null;
    let replayOf: any = null;

    const detachedTimeout = await this.settings.get<number>('chat.runDetachedTimeoutMs');
    let preparedAgent:Awaited<ReturnType<AgentExecutionService['prepareTx']>>|null=null;
    const assistant = await this.prisma.$transaction(async tx => {
      // A first write serializes same-message admission, clearing and count reservation on SQLite.
      await tx.$executeRaw`UPDATE "users" SET "id" = "id" WHERE "id" = ${userId}`;
      const eligible = await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!eligible) throw new BusinessException(ErrorCode.FORBIDDEN, '账户不可用', 403);
      const extensionMessageId=extensionAdmission?await this.extensions!.assertChatTx(tx,extensionAdmission):null;
      if(agent)await this.agents!.assertOfferTx(tx,agent);
      if(app){const eligibleApp=await tx.app.findFirst({where:{AND:[accessibleAppWhere(userId,app.id),{version:app.version}]},select:{id:true}});if(!eligibleApp)throw new BusinessException(ErrorCode.PARAM_INVALID,'应用内容或公开状态已变化，请重新打开',409);if(app.origin==='USER'){const restricted=await this.moderation.checkTx(tx,[app.name,app.description,app.systemPrompt,app.greeting].filter(Boolean).join('\n'));if(restricted)throw new BusinessException(restricted.action==='block'?ErrorCode.CONTENT_BLOCKED:ErrorCode.CONTENT_REVIEW,'应用设定命中当前内容限制，请联系创作者调整',400);}}
      if (newConversation) await tx.conversation.create({ data: { id: conversationId, userId, modelId: demoMode ? null : model.id, appId: app?.id ?? null, agentId:agent?.agent.id??null,title } });
      else {
        const locked = await tx.conversation.updateMany({ where: { id: conversationId, userId, deletedAt: null }, data: { lastMessageAt: new Date() } });
        if (!locked.count) throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在', 404);
      }

      if (dto.regenerateOf) {
        const previous = await tx.message.findFirst({
          where: { id: dto.regenerateOf, conversationId, role: 'ASSISTANT', deletedAt: null },
        });
        if (!previous) {
          throw new BusinessException(ErrorCode.NOT_FOUND, '要重新生成的消息不存在', 404);
        }
        if (['PENDING', 'STREAMING', 'SETTLING'].includes(previous.status)) throw new BusinessException(ErrorCode.CONVERSATION_BUSY, '这条回复仍在生成或结算中，请稍候', 409);
        // 分支挂在同一个父节点下（同一条用户提问），形成可对比的多条回复
        userMsg = previous.parentId
          ? await tx.message.findUnique({ where: { id: previous.parentId } })
          : null;
      } else if (dto.clientMsgId) {
        userMsg = await tx.message
          .findUnique({
            where: {
              conversationId_clientMsgId: {
                conversationId,
                clientMsgId: dto.clientMsgId,
              },
            },
          })
          .catch(() => null);

        // 幂等重放：这条提问已经有助手回答了，就别再新建一条（否则客户端重试会出现两份回答）
        if (userMsg) {
          if (userMsg.deletedAt) throw new BusinessException(ErrorCode.CONVERSATION_BUSY, '此请求的消息已清空，请发送一条新消息', 409);
          const last = await tx.message.findFirst({
            where: { parentId: userMsg.id, role: 'ASSISTANT', deletedAt: null, ...(extensionMessageId?{id:extensionMessageId}:{}) },
            orderBy: { createdAt: extensionAdmission?'asc':'desc' },
          });
          // 上一次请求还在跑：直接 409，既不重复生成也不覆盖进行中的结果
          if (last && (['PENDING', 'STREAMING', 'SETTLING'].includes(last.status))) {
            throw new BusinessException(ErrorCode.CONVERSATION_BUSY, '相同消息正在生成中，请稍候', 409);
          }
          // 只有“成功完成”才原样回放；失败/中止的允许重试，生成一条新的回答
          if (last && (last.status === 'COMPLETED'||extensionAdmission)) replayOf = last;
        }
      }

      if(agent&&userMsg&&(userMsg.content!==lastUser.content||JSON.stringify((()=>{try{return JSON.parse(userMsg.parts||'{}').attachments?.map((item:any)=>item.id)||[];}catch{return[];}})())!==JSON.stringify(lastUserAttachments.map(item=>item.id))))throw new BusinessException(ErrorCode.PARAM_INVALID,'同一次提问的内容与附件已变化，请发送新消息',409);
      if(agent&&dto.regenerateOf&&!userMsg)throw new BusinessException(ErrorCode.NOT_FOUND,'原提问已删除，无法重新生成',404);
      if (!userMsg && !dto.regenerateOf) {
        userMsg = await tx.message.create({
          data: {
            conversationId,
            role: 'USER',
            status: 'COMPLETED',
            content: lastUser.content,
            // 附件清单落在 parts 里：回看历史时能显示文件卡片，重新生成时前端照原样带回
            parts: lastUserAttachments.length ? JSON.stringify({ attachments: lastUserAttachments }) : null,
            clientMsgId: dto.clientMsgId ?? null,
            promptTokens: this.estimateTokens(lastUser.content),
          },
        });
      }

      // ---- 助手消息占位（先落库，SSE 才有 messageId 可用，sweeper 也能兜底）----
      // 幂等重放时复用已有消息，不再新建占位，避免污染会话分支
      const createdAssistant =
        replayOf ??
        (await tx.message.create({
          data: {
            conversationId,
            parentId: userMsg?.id ?? null,
            role: 'ASSISTANT',
            status: 'PENDING',
            ...(dto.webSearch?{searchJson:JSON.stringify({requested:true,status:'requested',sources:[],citations:[]})}:{}),
            content: '',
            modelName: model.name,
            modelId: demoMode ? null : model.id,
          },
        }));
      if(!replayOf&&extensionAdmission)await this.extensions!.bindChatTx(tx,extensionAdmission,createdAssistant.id);
      if(!replayOf&&agent)preparedAgent=await this.agentExecution!.prepareTx(tx,agent,userId,conversationId,createdAssistant.id,dto.agentParentId,nativeInput!.input);
      if (!replayOf && !agent && !demoMode && conversation.modelId !== model.id) {
        await tx.conversation.update({ where: { id: conversationId }, data: { modelId: model.id } });
      }
      return replayOf ?? this.accounting.acceptTx(tx, userId, createdAssistant, charge);
    });

    const liveRun = replayOf ? null : new ChatRun(userId, conversationId, assistant.id, detachedTimeout);
    if (liveRun) { this.runs.set(assistant.id, liveRun); liveRun.subscribe(res, 0); }
    else this.openSse(res);
    const output = liveRun ?? res;

    this.writeEvent(output, 'meta', {
      conversationId,
      // regenerate 分支可能找不到父消息（父消息已被删除），这里不能假设非空
      userMessageId: userMsg?.id ?? null,
      messageId: assistant.id,
      model: replayOf?.modelName || model.name,
      title,
      billing: messageBilling(assistant),
      ...(safeWebSearch(assistant.searchJson)?{webSearch:safeWebSearch(assistant.searchJson)}:{}),
      ...(safeAgentActivity(assistant.agentJson)?{agentActivity:safeAgentActivity(assistant.agentJson)}:{}),
      ...(agent?{agentId:agent.agent.id}:{}),
      ...(replayOf ? { replay: true } : {}),
    });

    // 幂等重放：把已经落库的结果原样吐回，不再打上游、不再计费
    if (replayOf) {
      if (replayOf.reasoning) this.writeEvent(output, 'reasoning', { v: replayOf.reasoning });
      if (replayOf.content) this.writeEvent(output, 'delta', { v: replayOf.content });
      this.writeEvent(output, 'done', {
        messageId: replayOf.id,
        status: replayOf.status,
        finishReason: replayOf.finishReason ?? null,
        promptTokens: replayOf.promptTokens ?? 0,
        completionTokens: replayOf.completionTokens ?? 0,
        durationMs: replayOf.durationMs ?? 0,
        billing: messageBilling(replayOf),
        usageEstimated: replayOf.usageEstimated,
        charged: replayOf.chargedAmount ? { pool: replayOf.billingPool, amount: replayOf.chargedAmount } : null,
        contextLimit: agent?null:model.maxContext,
        contextUsed: (replayOf.promptTokens ?? 0) + (replayOf.completionTokens ?? 0),
        ...(safeWebSearch(replayOf.searchJson)?{webSearch:safeWebSearch(replayOf.searchJson)}:{}),
        ...(safeAgentActivity(replayOf.agentJson)?{agentActivity:safeAgentActivity(replayOf.agentJson)}:{}),
      });
      try {
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }

    const run = liveRun!;
    const controller = run.controller;
    let full = '';
    let reasoning = '';
    let status: MsgStatus = 'COMPLETED';
    let finishReason: string | null = null;
    let errorCode: string | null = null;
    let ttfbMs: number | null = null;
    let sentAny = false;
    let usedChannelId: string | null = null;
    let successChannel: ResolvedChannel | null = null;
    let providerUsage: ProtocolUsage | null = null;

    const startedAt = Date.now();
    let flushTimer: NodeJS.Timeout | undefined;

    // 每 2 秒刷一次内容，避免每个 chunk 都写库
    flushTimer = setInterval(() => {
      void this.prisma.message
        .updateMany({
          where: { id: assistant.id, deletedAt: null, status: { in: ['PENDING', 'STREAMING'] } },
          data: { content: run.content, reasoning: run.reasoning || null,...(run.webSearch?{searchJson:JSON.stringify(safeWebSearch(run.webSearch))}:{}),...(run.agentActivity?{agentJson:JSON.stringify(safeAgentActivity(run.agentActivity))}:{}) },
        })
        .catch(() => void 0);
    }, 2_000);

    try {
      if(agent){
        const out=await this.agentExecution!.stream(preparedAgent!,agent,run,()=>{if(ttfbMs===null)ttfbMs=Date.now()-startedAt;if(!sentAny){sentAny=true;void this.prisma.message.updateMany({where:{id:assistant.id,status:'PENDING'},data:{status:'STREAMING'}}).catch(()=>{});}});
        full=out.text;reasoning=out.reasoning;finishReason=out.finishReason;providerUsage=out.usage;
      }else{
      const maxAttempts = Math.min(channels.length, 3);
      let lastError: any = null;
      // Key 级失败（401/403/429）时在同一渠道换一把 Key，不消耗换渠道次数，也不记渠道熔断
      const triedKeys = new Set<string>();
      let keyRetries = 0;
      let sameChannelRetry = false;
      let attemptNo = 0;

      for (let i = 0; i < maxAttempts; i += 1) {
        const upstreamChannel = channels[i];
        const pooled = upstreamChannel.type !== 'DEMO' && upstreamChannel.type !== 'MOCK';

        // 先选 Key：这个渠道的 Key 全部禁用 / 冷却时直接换下一个渠道（不占用熔断探针）
        const key = pooled ? await this.keyPool.pick(upstreamChannel, triedKeys) : null;
        if (pooled && !key) {
          sameChannelRetry = false;
          continue;
        }

        // HALF_OPEN 下只允许一个探针；同渠道换 Key 重试时探针已经在手里
        if (!sameChannelRetry && !this.breakers.tryAcquire(upstreamChannel.id)) continue;
        sameChannelRetry = false;

        const channel = key ? { ...upstreamChannel, apiKey: key.apiKey } : upstreamChannel;
        usedChannelId = channel.id;
        attemptNo += 1;
        const attemptStart = Date.now();

        try {
          const onFirstToken = () => {
            if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
            if (!sentAny) {
              sentAny = true;
              void this.prisma.message
                .updateMany({ where: { id: assistant.id, status: { in: ['PENDING', 'STREAMING'] } }, data: { status: 'STREAMING' } })
                .catch(() => void 0);
            }
          };

          if (channel.type === 'DEMO') {
            const out = await this.streamDemo(run, controller.signal, onFirstToken);
            full = out.text;
            finishReason = 'stop';
          } else if (channel.type === 'MOCK') {
            const out = await this.streamMock(
              lastUser.content,
              chatMessages.find((m) => m.role === 'system')?.content ?? '',
              run,
              controller.signal,
              onFirstToken,
            );
            full = out.text;
            finishReason = 'stop';
          } else {
            const out = await this.streamUpstream(model, channel, dto, upstreamMessages, run, controller.signal, onFirstToken);
            full = out.text;
            reasoning = out.reasoning;
            finishReason = out.finishReason;
            providerUsage = out.usage;
          }

          successChannel = channel;
          if (!demoMode) this.breakers.recordSuccess(channel.id);
          if (key) this.keyPool.reportSuccess(key);
          await this.recordAttempt(assistant.id, attemptNo, channel.id, 'ok', 200, null, Date.now() - attemptStart);
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          const httpStatus = err instanceof UpstreamError ? err.status : null;
          const cls = this.classify(err, controller.signal.aborted);

          // Key 级问题先落到这把 Key 上；同渠道还有别的 Key 时，渠道本身不算坏
          let retrySameChannel = false;
          if (key && !demoMode && this.keyPool.isKeyLevel(cls.errorCode)) {
            triedKeys.add(key.ref);
            await this.keyPool.reportFailure(channel.id, key, cls.errorCode, cls.cooldownMs);
            retrySameChannel =
              !sentAny && run.webSearch?.status!=='searching' && !run.webSearch?.sources.length &&
              cls.outcome === 'retryable' &&
              keyRetries < 3 &&
              (await this.keyPool.hasAlternative(upstreamChannel, triedKeys));
          }

          // 更新熔断状态：该熔断的记失败，只是限流的冷却一会儿
          if (retrySameChannel) {
            /* 换 Key 重试，不动渠道熔断 */
          } else if (!demoMode && cls.tripBreaker) {
            this.breakers.recordFailure(channel.id, cls.errorCode, cls.cooldownMs);
          } else if (!demoMode && cls.cooldownMs) {
            this.breakers.coolDown(channel.id, cls.cooldownMs);
          }

          await this.recordAttempt(
            assistant.id,
            attemptNo,
            channel.id,
            cls.outcome,
            httpStatus,
            cls.errorCode,
            Date.now() - attemptStart,
          );

          // 首字节之后绝不重试
          if (sentAny || run.webSearch?.status==='searching' || run.webSearch?.sources.length || cls.outcome !== 'retryable') throw err;
          if (retrySameChannel) {
            keyRetries += 1;
            sameChannelRetry = true;
            i -= 1;
            this.logger.warn(`渠道 ${channel.name} 的一把 Key 失败（${cls.errorCode}），换同渠道另一把 Key 重试`);
            continue;
          }
          this.logger.warn(`渠道 ${channel.name} 失败（${cls.errorCode}），尝试下一个: ${err?.message}`);
        }
      }

      if (!successChannel) {
        // 所有渠道都被熔断探针挡掉时 lastError 仍是 null：这里必须显式报错，
        // 否则会以“成功但空回答”收尾，用户拿到一条 0 token 的假结果
        throw lastError ?? new UpstreamError(503, '所有渠道均在熔断冷却中，请稍后再试');
      }
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        status = 'ABORTED';
        finishReason = run.cancelReason || 'user_cancel';
      } else {
        status = 'FAILED';
        const cls = this.classify(err, controller.signal.aborted);
        errorCode = cls.errorCode;
        finishReason = 'error';
        this.logger.warn(`chat failed(${cls.errorCode}): ${err?.message}`);
        {
          this.writeEvent(output, 'error', {
            code: errorCode,
            message: err?.message?.slice(0, 300) ?? '上游调用失败',
            retryable: cls.outcome === 'retryable',
          });
        }
      }
    } finally {
      run.seal();
      if (controller.signal.aborted) { status = 'ABORTED'; finishReason = run.cancelReason || 'user_cancel'; errorCode = null; }
      full = run.content;
      reasoning = run.reasoning;
      if(dto.webSearch){
        const search=safeWebSearch(run.webSearch)||{requested:true as const,status:'requested' as const,sources:[],citations:[]};
        const finalSearch={...search,status:status==='COMPLETED'?(search.sources.length?'complete' as const:'no_sources' as const):status==='ABORTED'?'interrupted' as const:'failed' as const};
        this.writeEvent(output,'search',finalSearch);
      }
      if(agent){
        let activity=safeAgentActivity(run.agentActivity||assistant.agentJson)!;
        try{activity=await this.agentExecution!.finalActivity(assistant.id,status,activity);}catch{activity={...activity,status:status==='COMPLETED'?'completed':status==='ABORTED'?'interrupted':'failed'};}
        this.writeEvent(output,'agent',activity);
      }
      if (flushTimer) clearInterval(flushTimer);

      const promptTokens = providerUsage?.promptTokens ?? this.estimateTokens(
        (agent?upstreamMessages:truncateContext(upstreamMessages, { maxContext: model.maxContext, maxOutput: model.maxOutput })).map(m => m.content).join('\n'),
      );
      const completionTokens = providerUsage?.completionTokens ?? this.estimateTokens(full);
      const usageEstimated = !providerUsage;
      const durationMs = Date.now() - startedAt;

      const billable = status === 'COMPLETED';
      const usage = !demoMode && status !== 'FAILED' && (full || promptTokens > 0)
        ? { userId, modelName: model.name, priceInPerM: model.priceInPerM, priceOutPerM: model.priceOutPerM,
            costMicros: billable ? Math.round((promptTokens * model.priceInPerM + completionTokens * model.priceOutPerM) / 1_000_000) : 0 }
        : null;
      try {
        let settled: Awaited<ReturnType<ChatAccountingService['complete']>> = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.accounting.stage(assistant.id, { content: full, reasoning: reasoning || null, status,
              promptTokens, completionTokens, finishReason, errorCode, ttfbMs, durationMs, channelId: usedChannelId, usage, estimated: usageEstimated,
              ...(run.webSearch?{webSearch:run.webSearch}:{}),...(run.agentActivity?{agentActivity:run.agentActivity,usageKind:'agent' as const}:{}) });
            settled = await this.accounting.complete(assistant.id); break;
          } catch (error) { if (attempt === 2) throw error; await this.sleep(80 * (attempt + 1)); }
        }
        if (!settled || !['COMPLETED', 'ABORTED', 'FAILED'].includes(settled.status)) throw new Error('回复仍在保存与结算中');
        const billing = messageBilling(settled);
        this.writeEvent(output, 'done', { messageId: assistant.id, status: settled.status,
          finishReason: settled.finishReason, promptTokens: settled.promptTokens, completionTokens: settled.completionTokens, durationMs, usageEstimated: settled.usageEstimated,
          contextLimit: agent?null:model.maxContext, contextUsed: promptTokens + completionTokens, billing,
          charged: billing?.charged ? { pool: billing.pool, amount: billing.charged } : null,
          ...(safeWebSearch(settled.searchJson)?{webSearch:safeWebSearch(settled.searchJson)}:{}),...(safeAgentActivity(settled.agentJson)?{agentActivity:safeAgentActivity(settled.agentJson)}:{}) });
      } catch (error) {
        this.logger.error('回复保存或结算待重试 ' + assistant.id + ': ' + (error as Error).message);
        // End this observer without falsely announcing success. GET recovery only retries saved settlement.
        this.writeEvent(output, 'snapshot', { messageId: assistant.id, conversationId, userMessageId: userMsg?.id ?? null,
          content: full, reasoning, status: 'SETTLING', errorCode: 'settlement_pending', charged: null });
      } finally {
        run.finish(); this.runs.delete(assistant.id);
      }
    }
  }

  private async recordAttempt(
    messageId: string,
    attemptNo: number,
    channelId: string,
    outcome: string,
    httpStatus: number | null,
    errorCode: string | null,
    ttfbMs: number,
  ) {
    await this.prisma.chatAttempt
      .create({
        data: {
          messageId,
          attemptNo,
          channelId,
          outcome,
          httpStatus: httpStatus ?? undefined,
          errorCode: errorCode ?? undefined,
          ttfbMs,
        },
      })
      .catch(() => void 0);
  }

  /** 统一把异常映射到错误分类表 */
  private classify(err: any, clientAborted: boolean) {
    if (clientAborted) return classifyFailure(null, 'abort');
    if (err instanceof UpstreamError) return classifyFailure(err.status, 'http');
    if (err?.name === 'AbortError') {
      return classifyFailure(null, clientAborted ? 'abort' : 'timeout');
    }
    return classifyFailure(null, 'network');
  }

  /** 演示站模式：不调用任何上游，只演示流式效果 */
  private async streamDemo(res: ChatRun, signal: AbortSignal, onFirstToken: () => void) {
    const reply =
      '（演示站模式）界面与流式效果都是真实的，但这条回答由本地生成，没有调用任何模型。\n\n' +
      '管理员在后台关闭「演示站模式」后，这里会返回真实模型的回答。';

    let out = '';
    for (let i = 0; i < reply.length; i += 4) {
      if (signal.aborted) break;
      if (i === 0) onFirstToken();
      const piece = reply.slice(i, i + 4);
      out += piece;
      this.writeEvent(res, 'delta', { v: piece });
      await this.sleep(10);
    }
    return { text: out };
  }

  // ---------------------------------------------------------------- 两种上游

  private async streamMock(
    userText: string,
    systemText: string,
    res: ChatRun,
    signal: AbortSignal,
    onFirstToken: () => void,
  ) {
    // 回显 system prompt 前 30 字，便于验证"应用注入"是否真的生效
    const reply =
      `SYS:${systemText ? systemText.slice(0, 30) : 'none'}|` +
      `（Mock 渠道）我已收到你的消息：「${userText.slice(0, 40)}」。\n\n` +
      '这是一条本地模拟回复，用于在没有真实 API Key 的情况下验证整条链路：' +
      'SSE 事件顺序、逐字流式、消息落库、用量记录、会话标题自动生成。\n\n' +
      '在后台配置真实渠道后，同一段代码会转发到上游模型，前端无需改动。';

    let out = '';
    for (let i = 0; i < reply.length; i += 3) {
      if (signal.aborted) break;
      if (i === 0) onFirstToken();
      const piece = reply.slice(i, i + 3);
      out += piece;
      this.writeEvent(res, 'delta', { v: piece });
      await this.sleep(12);
    }
    return { text: out, reasoning: '', finishReason: 'stop' };
  }

  private async streamUpstream(
    model: { maxContext: number; maxOutput: number },
    channel: ResolvedChannel,
    dto: ChatCompletionDto,
    inputMessages: ResolvedMessage[],
    res: ChatRun,
    signal: AbortSignal,
    onFirstToken: () => void,
  ) {
    const request = buildChatRequest(channel, truncateContext(inputMessages, { maxContext: model.maxContext, maxOutput: model.maxOutput }), {
      maxTokens: Math.min(dto.maxTokens ?? model.maxOutput, model.maxOutput), temperature: dto.temperature,webSearch:dto.webSearch,
    });
    const upstream = await safeFetch(request.url, request.init, {
      timeoutMs: channel.timeoutMs, signal,
      allowHttp: (await this.settings.get<boolean>('upstream.allowHttp')) || undefined,
      hostAllowlist: (await this.settings.get<string>('upstream.hostAllowlist')).split(',').map(s => s.trim()).filter(Boolean),
    });
    let first = true;
    return readChatResponse(upstream, request.type, (event, value) => {
      if (first) { first = false; onFirstToken(); }
      this.writeEvent(res, event, { v: value });
    }, signal, channel.timeoutMs,{webSearch:dto.webSearch,onSearch:report=>this.writeEvent(res,'search',report)});
  }
}
