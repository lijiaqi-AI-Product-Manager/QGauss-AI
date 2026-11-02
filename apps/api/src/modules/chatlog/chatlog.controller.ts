import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatLogService } from './chatlog.service';

@Controller('chat-logs')
export class ChatLogController {
  constructor(private readonly chatLog: ChatLogService) {}

  private parse(q: any) {
    return {
      userId: q.userId || undefined,
      modelName: q.modelName || undefined,
      status: q.status || undefined,
      keyword: q.keyword || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    };
  }

  /** page/pageSize 一律夹到合法区间：NaN / 负数 / 超大值都会让 Prisma 报错或拖库 */
  private paging(q: any) {
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(q.pageSize) || 20)));
    return { page, pageSize };
  }

  @Roles('ADMIN')
  @Get()
  list(@Query() q: any) {
    const { page, pageSize } = this.paging(q);
    return this.chatLog.list(this.parse(q), page, pageSize);
  }

  @Roles('ADMIN')
  @Get('export')
  async export(@Query() q: any, @Res() res: Response) {
    await this.chatLog.exportToStream(this.parse(q), res);
  }
}
