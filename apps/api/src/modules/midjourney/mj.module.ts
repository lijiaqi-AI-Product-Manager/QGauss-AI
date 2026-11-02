import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { CommerceModule } from '../commerce/commerce.module';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { ModerationModule } from '../moderation/moderation.module';
import { MjController } from './mj.controller';
import { MjService } from './mj.service';
import { MjProvider } from './mj.provider';
import { MjWorker } from './mj.worker';
import { MjMediaService } from './mj-media.service';
import { MjAccountingService } from './mj-accounting.service';
import { MjConnectionService } from './mj-connection.service';
import { MjRunsService } from './mj-runs.service';
@Module({imports:[ModelsModule,CommerceModule,StorageModule,SettingsModule,ModerationModule],controllers:[MjController],exports:[MjService,MjMediaService],providers:[MjService,MjProvider,MjWorker,MjMediaService,MjAccountingService,MjConnectionService,MjRunsService]})
export class MjModule {}
