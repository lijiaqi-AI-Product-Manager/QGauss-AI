import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { CommerceModule } from '../commerce/commerce.module';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { ModerationModule } from '../moderation/moderation.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoProvider } from './video.provider';
import { VideoWorker } from './video.worker';
import { VideoMediaService } from './video-media.service';
import { VideoAccountingService } from './video-accounting.service';
import { VideoConnectionService } from './video-connection.service';
import { VideoRunsService } from './video-runs.service';
import {VideoMaterialsService} from './video-materials.service';
import {VideoMaterialUploadGuard} from './video-material-upload.guard';
@Module({ imports: [ModelsModule, CommerceModule, StorageModule, SettingsModule, ModerationModule], controllers: [VideoController], providers: [VideoService, VideoProvider, VideoWorker, VideoMediaService, VideoAccountingService, VideoConnectionService, VideoRunsService,VideoMaterialsService,VideoMaterialUploadGuard] })
export class VideoModule {}
