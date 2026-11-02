import { Injectable } from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService, Pool } from '../commerce/ledger.service';
import { WebSearchReport, safeWebSearch } from '../../common/llm/web-search';
import { AgentActivity, safeAgentActivity } from '../../common/llm/agent-activity';

type Outcome = {
  status: 'COMPLETED' | 'ABORTED' | 'FAILED'; content: string; reasoning: string | null;
  promptTokens: number; completionTokens: number; finishReason: string | null;
  errorCode: string | null; ttfbMs: number | null; durationMs: number; channelId: string | null;
  usage: { userId: string; modelName: string; priceInPerM: number; priceOutPerM: number; costMicros: number } | null;
  estimated?: boolean;
  webSearch?: WebSearchReport | null;
  agentActivity?:AgentActivity|null;
  usageKind?:'chat'|'agent';
};

export function messageBilling(message: Pick<Message, 'billingState' | 'billingPool' | 'reservedAmount' | 'chargedAmount' | 'returnedAmount' | 'expiredAmount'>) {
  if (message.billingState === 'LEGACY') return null;
  return { state: message.billingState, pool: message.billingPool || null, limit: message.reservedAmount,
    reserved: ['RESERVED', 'SETTLING'].includes(message.billingState) ? message.reservedAmount : 0,
    charged: message.chargedAmount, returned: message.returnedAmount, expired: message.expiredAmount };
}

/** Generation, saved result, count authorization and final ledger have separate durable phases. */
@Injectable()
export class ChatAccountingService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  async acceptTx(tx: Prisma.TransactionClient, userId: string, message: Message, charge: { pool: Pool; amount: number } | null) {
    if (charge) await this.ledger.reserveCountTx(tx, userId, { ...charge, refId: message.id, bizType: 'chat', model: message.modelName || '', modelName: message.modelName || '' });
    return tx.message.update({ where: { id: message.id }, data: { billingState: charge ? 'RESERVED' : 'FREE', billingPool: charge?.pool || '', reservedAmount: charge?.amount || 0 } });
  }

  async stage(messageId: string, outcome: Outcome) {
    // Never overwrite an already saved outcome with a later retry or cancellation.
    const changed = await this.prisma.message.updateMany({ where: { id: messageId, status: { in: ['PENDING', 'STREAMING'] } }, data: {
      content: outcome.content, reasoning: outcome.reasoning, status: 'SETTLING', billingState: 'SETTLING',
      promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens, usageEstimated: outcome.estimated !== false,
      finishReason: outcome.finishReason, errorCode: outcome.errorCode, ttfbMs: outcome.ttfbMs,
      durationMs: outcome.durationMs, channelId: outcome.channelId, settlementJson: JSON.stringify(outcome),
      ...(outcome.webSearch?{searchJson:JSON.stringify(safeWebSearch(outcome.webSearch))}:{}),
      ...(outcome.agentActivity?{agentJson:JSON.stringify(safeAgentActivity(outcome.agentActivity))}:{}),
    } });
    return changed.count > 0;
  }

  async complete(messageId: string) {
    return this.prisma.$transaction(async tx => {
      // Acquire the writer before reading the accepted amount or touching any audit row.
      const claimed = await tx.message.updateMany({ where: { id: messageId, status: 'SETTLING', billingState: 'SETTLING' }, data: { status: 'SETTLING' } });
      const message = await tx.message.findUnique({ where: { id: messageId }, include: { conversation: { select: { userId: true } } } });
      if (!message || !claimed.count) return message;
      const outcome: Outcome = JSON.parse(message.settlementJson || 'null');
      if (!outcome || !['COMPLETED', 'ABORTED', 'FAILED'].includes(outcome.status) || (outcome.usage && outcome.usage.userId !== message.conversation.userId)) throw new Error('回复结算快照不完整');
      const amount = outcome.status === 'COMPLETED' ? message.reservedAmount : 0;
      let returnedAmount = 0, expiredAmount = 0;
      if (message.reservedAmount) {
        const settled = await this.ledger.settleCountReservationTx(tx, messageId, amount);
        if (settled.userId !== message.conversation.userId || settled.pool !== message.billingPool || settled.amount !== message.reservedAmount || settled.bizType !== 'chat') throw new Error('回复与次数预留不一致');
        returnedAmount = settled.returnedAmount; expiredAmount = settled.expiredAmount;
      }
      if (outcome.usage) {
        await tx.usageRecord.create({ data: { ...outcome.usage, messageId, kind: outcome.usageKind==='agent'?'agent':'chat', channelId: outcome.channelId, promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens, estimated: outcome.estimated !== false } });
      }
      const result = await tx.message.update({ where: { id: messageId }, data: { status: outcome.status,
        billingState: message.reservedAmount ? (amount ? 'SETTLED' : 'RELEASED') : 'FREE',
        chargedAmount: amount, returnedAmount, expiredAmount, settlementJson: null } });
      await tx.conversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: new Date() } });
      return result;
    });
  }

  /** A stopped process cannot resume an upstream stream. Saved complete output can still settle. */
  async recover(messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return null;
    if (['PENDING', 'STREAMING'].includes(message.status)) {
      await this.stage(messageId, { status: 'FAILED', content: message.content, reasoning: message.reasoning,
        promptTokens: message.promptTokens || 0, completionTokens: message.completionTokens || 0,
        finishReason: 'error', errorCode: 'server_interrupted', ttfbMs: message.ttfbMs,
        durationMs: message.durationMs || 0, channelId: message.channelId, usage: null,
        ...(safeWebSearch(message.searchJson)?{webSearch:{...safeWebSearch(message.searchJson)!,status:'interrupted' as const}}:{}),
        ...(safeAgentActivity(message.agentJson)?{agentActivity:{...safeAgentActivity(message.agentJson)!,status:'interrupted' as const},usageKind:'agent' as const}:{}) });
    }
    return this.complete(messageId);
  }
}
