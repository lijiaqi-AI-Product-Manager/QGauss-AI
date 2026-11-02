import { Controller, Get, Param, ParseUUIDPipe, Post, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { MailService } from './mail.service';
import { MailOperationsService } from './mail-operations.service';
import { MailOutboxQuery, MailProbeDto } from './mail.dto';

@Controller('mail')
@Roles('ADMIN')
export class MailController {
  constructor(private readonly mail: MailService, private readonly operations: MailOperationsService) {}

  /** 后台查看发件箱（自托管场景排查邮件问题的唯一入口） */
  @Roles('ADMIN')
  @Get('outbox')
  outbox(@Query() query: MailOutboxQuery) {
    return this.mail.outbox(query.page, query.pageSize, query);
  }

  @Get('status')
  status(@Req() req: Request) { return this.operations.status((req as any).user.id); }

  @Get('templates')
  templates() { return this.operations.templates(); }

  @Post('probes')
  createProbe(@Req() req: Request, @Body() body: MailProbeDto) { return this.operations.createProbe((req as any).user.id, body.requestKey, req.ip || 'unknown'); }

  @Get('probes/:requestKey')
  probe(@Req() req: Request, @Param('requestKey', new ParseUUIDPipe({ version: '4' })) requestKey: string) { return this.operations.probe((req as any).user.id, requestKey); }

  @Post('probes/:id/confirm')
  confirm(@Req() req: Request, @Param('id') id: string) { return this.operations.confirm((req as any).user.id, id); }
}
