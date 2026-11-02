import { Injectable } from '@nestjs/common';
import { ModelsService } from './models.service';
import { SettingsService } from '../settings/settings.service';
import { chatBilling } from '../commerce/chat-pricing';

@Injectable()
export class ModelCatalogService {
  constructor(private readonly models: ModelsService, private readonly settings: SettingsService) {}

  private async flags() {
    const [commerce, demo] = await Promise.all([this.settings.get<boolean>('commerce.enabled'), this.settings.get<boolean>('demo.siteEnabled')]);
    return { commerce, demo };
  }

  async available() {
    const [models, flags] = await Promise.all([this.models.availableModels(), this.flags()]);
    return models.map(model => ({ ...model, billing: chatBilling(model, flags.commerce, flags.demo) }));
  }

  async plaza() {
    const [catalog, flags] = await Promise.all([this.models.plaza(), this.flags()]);
    return { ...catalog, models: catalog.models.map(model => ({ ...model, billing: chatBilling(model, flags.commerce, flags.demo) })) };
  }
}
