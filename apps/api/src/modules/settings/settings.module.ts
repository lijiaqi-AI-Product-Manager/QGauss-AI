import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsWorkspaceController } from './settings-workspace.controller';
import { SettingsWorkspaceService } from './settings-workspace.service';

@Module({
  controllers: [SettingsController, SettingsWorkspaceController],
  providers: [SettingsService, SettingsWorkspaceService],
  exports: [SettingsService],
})
export class SettingsModule {}
