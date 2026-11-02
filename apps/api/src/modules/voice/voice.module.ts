import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { CommerceModule } from '../commerce/commerce.module';
import { StorageModule } from '../storage/storage.module';
import { ModerationModule } from '../moderation/moderation.module';
import { SettingsModule } from '../settings/settings.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { VoiceAccountingService } from './voice-accounting.service';
@Module({imports:[ModelsModule,CommerceModule,StorageModule,ModerationModule,SettingsModule],controllers:[VoiceController],providers:[VoiceService,VoiceAccountingService],exports:[VoiceService]})
export class VoiceModule{}
