import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import {AppCreatorService} from './app-creator.service';
import {CommerceModule} from '../commerce/commerce.module';
import {ModerationModule} from '../moderation/moderation.module';

@Module({
  imports:[CommerceModule,ModerationModule],
  controllers: [AppsController],
  providers: [AppsService,AppCreatorService],
  exports: [AppsService],
})
export class AppsModule {}
