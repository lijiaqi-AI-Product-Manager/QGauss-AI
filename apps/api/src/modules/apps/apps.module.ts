import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import {AppCreatorService} from './app-creator.service';
import {CommerceModule} from '../commerce/commerce.module';
import {ModerationModule} from '../moderation/moderation.module';
import {StorageModule} from '../storage/storage.module';
import {AppImageService} from './app-image.service';
import {AppImageUploadGuard} from './app-image-upload.guard';

@Module({
  imports:[CommerceModule,ModerationModule,StorageModule],
  controllers: [AppsController],
  providers: [AppsService,AppCreatorService,AppImageService,AppImageUploadGuard],
  exports: [AppsService],
})
export class AppsModule {}
