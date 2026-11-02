import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatCompletionDto } from './dto/chat.dto';
import { QuotaService } from './quota.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly quota: QuotaService,
  ) {}

  /** 当前用户今日额度 */
  @Get('quota')
  quotaSummary(@CurrentUser() user: AuthUser) {
    return this.quota.summary(user.id);
  }

  @Get('runs/:messageId/events')
  async events(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string, @Query('after') after: unknown, @Headers('last-event-id') lastEventId: unknown, @Res() res: Response) {
    const raw = after ?? lastEventId;
    let cursor: number | null = null;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > Number.MAX_SAFE_INTEGER - 2) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '无效的回复断点', 400);
      }
      cursor = Number(raw);
    }
    await this.chat.events(user.id, messageId, cursor, res);
  }

  @Post('runs/:messageId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string) {
    return this.chat.cancel(user.id, messageId);
  }

  /**
   * SSE 流式补全。
   * 事件顺序：meta → (reasoning | delta)* → (error) → done
   */
  @Post('completions')
  async completions(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChatCompletionDto,
    @Res() res: Response,
  ) {
    await this.chat.completions(user.id, dto, res);
  }
}
