import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ModelsModule } from '../models/models.module';
import { InstallationController } from './installation.controller';
import { InstallationService } from './installation.service';
import { InstallationOwnerGuard } from './installation.guards';
import { MailModule } from '../mail/mail.module';

@Module({ imports: [SettingsModule, ModelsModule, MailModule], controllers: [InstallationController], providers: [InstallationService, InstallationOwnerGuard], exports: [InstallationService] })
export class InstallationModule {}
