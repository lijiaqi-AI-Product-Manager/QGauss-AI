import { Body, Controller, Get, Header, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PaymentStatementService } from './payment-statement.service';
import { paymentStatementPreview, STATEMENT_MAX_BYTES } from './payment-statement-input';

const uploadLimits = { files: 1, fileSize: STATEMENT_MAX_BYTES, fields: 6, fieldSize: 512, parts: 8 };

@Controller('admin/payment-statements')
@Roles('ADMIN')
export class PaymentStatementController {
  constructor(private readonly statements: PaymentStatementService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: Record<string, unknown>) {
    return this.statements.list(query);
  }

  @Post('preview')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits }))
  preview(@UploadedFile() file: { buffer: Buffer } | undefined, @Body() fields: Record<string, unknown>) {
    if (!file) throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择 CSV 账单文件', 400);
    return paymentStatementPreview(file.buffer, fields);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits }))
  importStatement(
    @CurrentUser('id') actorId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() fields: Record<string, unknown>,
  ) {
    if (!file) throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择 CSV 账单文件', 400);
    const fileName = typeof fields.fileName === 'string' ? fields.fileName : file.originalname;
    return this.statements.importStatement(actorId, fileName, file.buffer, fields);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.statements.detail(id, query);
  }

  @Get(':id/export')
  @Header('Cache-Control', 'private, no-store')
  exportStatement(@Param('id') id: string, @Query('state') state: unknown) {
    return this.statements.detail(id, { state }, true);
  }

  @Patch(':id/rows/:rowId')
  decide(
    @Param('id') id: string, @Param('rowId') rowId: string,
    @CurrentUser('id') actorId: string, @Body() fields: Record<string, unknown>,
  ) {
    return this.statements.decide(id, rowId, actorId, fields);
  }
}
