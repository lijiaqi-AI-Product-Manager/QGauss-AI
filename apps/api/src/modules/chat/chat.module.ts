import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { SettingsModule } from '../settings/settings.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AppsModule } from '../apps/apps.module';
import { CommerceModule } from '../commerce/commerce.module';
import { StorageModule } from '../storage/storage.module';
import { AgentsModule } from '../agents/agents.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { QuotaService } from './quota.service';
import { AttachmentsService } from './attachments.service';
import { ChatAccountingService } from './chat-accounting.service';
import {ExtensionsModule} from '../extensions/extensions.module';

@Module({
  // CommerceModule supplies count reservations and atomic settlement; StorageModule reads attachments.
  imports: [ModelsModule, SettingsModule, ModerationModule, AppsModule, CommerceModule, StorageModule, AgentsModule, ExtensionsModule],
  controllers: [ChatController],
  providers: [ChatService, QuotaService, AttachmentsService, ChatAccountingService],
  exports: [QuotaService, ChatService],
})
export class ChatModule {}
