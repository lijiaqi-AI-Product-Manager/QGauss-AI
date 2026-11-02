import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import {
  BulkRemoveConversationsDto,
  CreateConversationDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.id, dto.modelId, dto.title);
  }

  /** 放在 :id 路由之前声明，避免被当成会话 id */
  @Post('bulk-delete')
  bulkRemove(@CurrentUser() user: AuthUser, @Body() dto: BulkRemoveConversationsDto) {
    return this.conversations.bulkRemove(user.id, dto);
  }

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
