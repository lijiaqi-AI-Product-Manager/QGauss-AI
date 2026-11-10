import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatLogService } from './chatlog.service';
import { parseChatLogQuery, recordPaging } from './chatlog.query';

@Controller('chat-logs')
export class ChatLogController {
  constructor(private readonly chatLog: ChatLogService) {}

  @Roles('ADMIN')
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() q: any) {
    const { page, pageSize } = recordPaging(q);
    return this.chatLog.list(parseChatLogQuery(q), page, pageSize);
  }

  @Roles('ADMIN')
  @Get('export')
  async export(@Query() q: Record<string, unknown>, @Res() res: Response, @Req() req: { user: { id: string } }) {
    await this.chatLog.exportToStream(parseChatLogQuery(q), res, req.user.id);
  }

  @Roles('ADMIN')
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string) {
    return this.chatLog.detail(id);
  }
}
