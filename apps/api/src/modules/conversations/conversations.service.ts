import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { ChatService } from '../chat/chat.service';
import { messageBilling } from '../chat/chat-accounting.service';
import { safeWebSearch } from '../../common/llm/web-search';
import { publicAgentActivity } from '../../common/llm/agent-activity';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService, private readonly chat: ChatService) {}

  async list(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ pinnedAt: 'desc' }, { lastMessageAt: 'desc' }],
      take: 100,
      include: { _count: { select: { messages: { where: { deletedAt: null } } } }, app: { select: { id: true, name: true, icon: true } },agent:{select:{id:true,name:true}}, messages: { where: { deletedAt: null, role: 'ASSISTANT', status: { in: ['PENDING', 'STREAMING', 'SETTLING'] } }, select: { id: true, status: true }, take: 1, orderBy: { createdAt: 'desc' } } },
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      modelId: c.modelId,
      folderId: c.folderId,
      appId: c.appId,
      app: c.app,
      agentId:c.agentId,agent:c.agent,
      pinned: !!c.pinnedAt,
      messageCount: c._count.messages,
      activeMessageId: c.messages[0]?.id ?? null,
      activeMessageStatus: c.messages[0]?.status ?? null,
      lastMessageAt: c.lastMessageAt,
    }));
  }

  async create(userId: string, modelId?: string, title?: string) {
    if (modelId) {
      const model = await this.prisma.aiModel.findUnique({ where: { id: modelId } });
      if (!model || model.deletedAt) {
        throw new BusinessException(ErrorCode.MODEL_NOT_FOUND, '模型不存在', 404);
      }
    }
    return this.prisma.conversation.create({
      data: { userId, modelId: modelId ?? null, title: title?.trim() || '新对话' },
    });
  }

  async detail(userId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include:{agentRun:{select:{cancelState:true}}},
        },
        model: { select: { id: true, name: true, displayName: true } },
        app: { select: { id: true, name: true, icon: true } },
        agent:{select:{id:true,name:true}},
      },
    });
    if (!conv) throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在', 404);
    return { ...conv, messages: conv.messages.map(({ settlementJson: _private, searchJson: _search,agentJson:_agent,agentRun:_run, ...message }) => ({ ...message, billing: messageBilling(message),...(safeWebSearch(_search)?{webSearch:safeWebSearch(_search)}:{}),...(publicAgentActivity(_agent,_run)?{agentActivity:publicAgentActivity(_agent,_run)}:{}) })) };
  }

  /** 读单条消息的落库状态：流断开后前端靠它补齐内容（Safari 等移动端断流常见） */
  async getMessage(userId: string, conversationId: string, messageId: string) {
    await this.assertOwner(userId, conversationId);

    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
      select: {
        id: true,
        parentId: true,
        role: true,
        status: true,
        content: true,
        reasoning: true,
        errorCode: true,
        finishReason: true,
        promptTokens: true,
        completionTokens: true,
        usageEstimated: true,
        updatedAt: true,
        searchJson: true,
        agentJson:true,agentRun:{select:{cancelState:true}},
        billingState: true, billingPool: true, reservedAmount: true, chargedAmount: true, returnedAmount: true, expiredAmount: true,
      },
    });
    if (!msg) throw new BusinessException(ErrorCode.NOT_FOUND, '消息不存在', 404);
    const {searchJson,agentJson,agentRun,...publicMessage}=msg;
    return { ...publicMessage, billing: messageBilling(msg),...(safeWebSearch(searchJson)?{webSearch:safeWebSearch(searchJson)}:{}),...(publicAgentActivity(agentJson,agentRun)?{agentActivity:publicAgentActivity(agentJson,agentRun)}:{}) };
  }

  /** 删除单条消息（软删，保留分支结构） */
  async deleteMessage(userId: string, conversationId: string, messageId: string) {
    await this.assertOwner(userId, conversationId);

    const msg = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
    });
    if (!msg) throw new BusinessException(ErrorCode.NOT_FOUND, '消息不存在', 404);

    this.chat.cancelConversationRuns(userId, conversationId, messageId);
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async update(
    userId: string,
    id: string,
    data: { title?: string; pinned?: boolean; folderId?: string | null; modelId?: string },
  ) {
    await this.assertOwner(userId, id);
    if (data.modelId !== undefined) {
      const conv=await this.prisma.conversation.findUnique({where:{id},select:{agentId:true}});if(conv?.agentId)throw new BusinessException(ErrorCode.PARAM_INVALID,'搭档会话使用智能体自身配置，无法切换模型',400);
      const model = await this.prisma.aiModel.findUnique({
        where: { id: data.modelId },
        select: { status: true, deletedAt: true, channels: { where: { enabled: true }, select: { channel: { select: { status: true, deletedAt: true } } } } },
      });
      if (!model || model.deletedAt) throw new BusinessException(ErrorCode.MODEL_NOT_FOUND, '模型不存在', 404);
      if (model.status !== 'ENABLED') throw new BusinessException(ErrorCode.MODEL_NOT_FOUND, '该模型已停用', 400);
      if (!model.channels.some(binding => binding.channel.status === 'ENABLED' && !binding.channel.deletedAt)) {
        throw new BusinessException(ErrorCode.CHANNEL_UNAVAILABLE, '该模型暂无可用渠道', 400);
      }
    }
    if (data.folderId) {
      const folder = await this.prisma.conversationFolder.findFirst({
        where: { id: data.folderId, userId },
        select: { id: true },
      });
      if (!folder) throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在', 404);
    }
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.pinned !== undefined ? { pinnedAt: data.pinned ? new Date() : null } : {}),
        ...(data.folderId !== undefined ? { folderId: data.folderId } : {}),
        ...(data.modelId !== undefined ? { modelId: data.modelId } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.assertOwner(userId, id);
    this.chat.cancelConversationRuns(userId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * 批量软删：只作用于本人的未删除会话，别人的 id 静默忽略（不泄露存在性）。
   * 返回实际删除条数，前端据此提示。
   */
  async bulkRemove(userId: string, data: { ids?: string[]; unpinnedOnly?: boolean }) {
    const ids = [...new Set(data.ids ?? [])];
    if (ids.length === 0 && !data.unpinnedOnly) return { count: 0 };
    const scopes = [
      ...(ids.length ? [{ id: { in: ids } }] : []),
      ...(data.unpinnedOnly ? [{ pinnedAt: null }] : []),
    ];
    const targets = await this.prisma.conversation.findMany({ where: { userId, deletedAt: null, OR: scopes }, select: { id: true } });
    for (const target of targets) this.chat.cancelConversationRuns(userId, target.id);
    const res = await this.prisma.conversation.updateMany({
      where: { userId, deletedAt: null, OR: scopes },
      data: { deletedAt: new Date() },
    });
    return { count: res.count };
  }

  async clearMessages(userId: string, id: string) {
    await this.assertOwner(userId, id);
    this.chat.cancelConversationRuns(userId, id);
    // Preserve accepted authorizations until their canceled runs release; hide the entire history immediately.
    await this.prisma.message.updateMany({ where: { conversationId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** 归属校验：查不到一律 404，不泄露资源是否存在 */
  async assertOwner(userId: string, id: string) {
    const hit = await this.prisma.conversation.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });
    if (!hit) throw new BusinessException(ErrorCode.CONVERSATION_NOT_FOUND, '会话不存在', 404);
  }
}
