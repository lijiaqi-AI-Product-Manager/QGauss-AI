import { Body, Controller, Delete, Get, Param, Patch, Post,Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import {ConversationHistoryService} from './conversation-history.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {ConversationHistoryDto,ConversationPreviewDto,ConversationStatusDto,ConversationVersionDto} from './dto/history.dto';
import {
  BulkRemoveConversationsDto,
  CreateConversationDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService,private readonly history:ConversationHistoryService) {}

  @Get('history') historyList(@CurrentUser() user:AuthUser,@Query() query:ConversationHistoryDto){return this.history.list(user.id,query);}
  @Post('status') status(@CurrentUser() user:AuthUser,@Body() body:ConversationStatusDto){return this.history.status(user.id,body);}
  @Post('bulk-preview') preview(@CurrentUser() user:AuthUser,@Body() body:ConversationPreviewDto){return this.history.preview(user.id,body);}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.id, dto.modelId, dto.title,dto.folderId);
  }

  /** 放在 :id 路由之前声明，避免被当成会话 id */
  @Post('bulk-delete')
  bulkRemove(@CurrentUser() user: AuthUser, @Body() dto: BulkRemoveConversationsDto) {
    if(dto.preview){if(dto.ids!==undefined||dto.unpinnedOnly!==undefined)throw new BusinessException(ErrorCode.PARAM_INVALID,'请只使用本次确认的整理范围',400);return this.history.remove(user.id,dto.preview);}return this.conversations.bulkRemove(user.id, dto);
  }

  @Post(':id/trash') trash(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:ConversationVersionDto){return this.conversations.remove(user.id,id,body.expectedVersion);}
  @Post(':id/restore') restore(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() body:ConversationVersionDto){return this.conversations.restore(user.id,id,body.expectedVersion);}

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.detail(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversations.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.remove(user.id, id);
  }

  @Delete(':id/messages')
  clear(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.clearMessages(user.id, id);
  }

  @Get(':id/messages/:messageId')
  message(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversations.getMessage(user.id, id, messageId);
  }

  @Delete(':id/messages/:messageId')
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversations.deleteMessage(user.id, id, messageId);
  }
}
