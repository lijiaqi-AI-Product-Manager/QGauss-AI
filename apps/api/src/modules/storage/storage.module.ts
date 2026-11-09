import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { StorageService } from './storage.service';
import { UploadController } from './upload.controller';
import {ChatUploadsService} from './chat-uploads.service';
import {AttachmentsService} from '../chat/attachments.service';

@Module({
  imports: [SettingsModule],
  controllers: [UploadController],
  providers: [StorageService,ChatUploadsService,AttachmentsService],
  exports: [StorageService,AttachmentsService],
})
export class StorageModule {}
