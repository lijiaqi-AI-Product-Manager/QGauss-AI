import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import {ConversationHistoryService} from './conversation-history.service';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [ChatModule],
  controllers: [ConversationsController],
  providers: [ConversationsService,ConversationHistoryService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
