import { Module } from '@nestjs/common';
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';
import { KeyPoolService } from './key-pool.service';
import { ModelCatalogService } from './model-catalog.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [ModelsController],
  providers: [ModelsService, KeyPoolService, ModelCatalogService],
  exports: [ModelsService, KeyPoolService, ModelCatalogService],
})
export class ModelsModule {}
