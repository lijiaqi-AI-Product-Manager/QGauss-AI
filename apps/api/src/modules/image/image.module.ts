import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { CommerceModule } from '../commerce/commerce.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ModelsModule } from '../models/models.module';
import { ImageController } from './image.controller';
import { ImageProvider } from './image.provider';
import { ImageService } from './image.service';
import { ImageWorker } from './image.worker';
import { ImageAccountingService } from './image-accounting.service';
import { ImageRunsService } from './image-runs.service';
import {ImageEditorController} from './image-editor.controller';
import {ImageEditorService} from './image-editor.service';

@Module({
  imports: [SettingsModule, StorageModule, CommerceModule, ModerationModule, ModelsModule],
  controllers: [ImageController,ImageEditorController],
  providers: [ImageService, ImageProvider, ImageWorker, ImageAccountingService, ImageRunsService,ImageEditorService],
  exports: [ImageService],
})
export class ImageModule {}
