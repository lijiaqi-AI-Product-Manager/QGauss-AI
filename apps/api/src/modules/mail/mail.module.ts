import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailOperationsService } from './mail-operations.service';

@Module({
  imports: [SettingsModule],
  controllers: [MailController],
  providers: [MailService, MailOperationsService],
  exports: [MailService, MailOperationsService],
})
export class MailModule {}
