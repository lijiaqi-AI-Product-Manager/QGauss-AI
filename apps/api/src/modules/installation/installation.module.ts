import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ModelsModule } from '../models/models.module';
import { InstallationController } from './installation.controller';
import { InstallationService } from './installation.service';
import { InstallationOwnerGuard } from './installation.guards';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { CommerceModule } from '../commerce/commerce.module';
import { LaunchReadinessService } from './launch-readiness.service';

@Module({
  imports: [SettingsModule, ModelsModule, MailModule, AuthModule, CommerceModule],
  controllers: [InstallationController],
  providers: [InstallationService, InstallationOwnerGuard, LaunchReadinessService],
  exports: [InstallationService],
})
export class InstallationModule {}
