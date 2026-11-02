import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { BreakerRegistry } from '../../common/llm/breaker';
import {
  AddChannelKeysDto,
  BindChannelDto,
  BulkRemoveChannelKeysDto,
  CreateChannelDto,
  CreateModelDto,
  UpdateChannelDto,
  UpdateChannelKeyDto,
  UpdateModelDto,
} from './dto/model.dto';
import { ModelsService } from './models.service';
import { KeyPoolService } from './key-pool.service';
import { ModelCatalogService } from './model-catalog.service';

@Controller('models')
export class ModelsController {
  constructor(
    private readonly models: ModelsService,
    private readonly breakers: BreakerRegistry,
    private readonly keyPool: KeyPoolService,
    private readonly catalog: ModelCatalogService,
  ) {}

  /** 普通用户：模型选择器 */
  @Get('available')
  available() {
    return this.catalog.available();
  }

  /** 普通用户：模型广场（按厂商分组的卡片数据） */
  @Get('plaza')
  plaza() {
    return this.catalog.plaza();
  }

  /** 后台：渠道运行时健康度（熔断状态，内存态） */
  @Roles('ADMIN')
  @Get('channels/health')
  async channelHealth() {
    const channels = await this.models.listChannels();
    const snapshots = new Map(this.breakers.snapshot().map((s) => [s.key, s]));
    return channels.map((c) => ({
      id: c.id,
      name: c.name,
      enabled: c.status === 'ENABLED',
      breaker: snapshots.get(c.id) ?? {
        key: c.id,
        state: 'CLOSED',
        cooldownMs: 0,
        consecutiveFailures: 0,
        samples: 0,
        failures: 0,
        openedAt: null,
        lastError: null,
      },
    }));
  }

  /** 手动恢复所有熔断（运维用：确认上游已修复后不必等冷却） */
  @Roles('ADMIN')
  @Post('channels/health/reset')
  resetBreakers() {
    this.breakers.reset();
    return { ok: true };
  }

  // ---------- 渠道 ----------
  @Roles('ADMIN')
  @Get('channels')
  listChannels() {
    return this.models.listChannels();
  }

  @Roles('ADMIN')
  @Post('channels')
  createChannel(@Body() dto: CreateChannelDto) {
    return this.models.createChannel(dto);
  }

  @Roles('ADMIN')
  @Post('channels/:id/test')
  testChannel(@Param('id') id: string) {
    return this.models.testChannel(id);
  }

  // ---------- 渠道 Key 池 ----------
  @Roles('ADMIN')
  @Get('channels/:id/keys')
  listKeys(@Param('id') id: string) {
    return this.keyPool.list(id);
  }

  @Roles('ADMIN')
  @Post('channels/:id/keys')
  addKeys(@Param('id') id: string, @Body() dto: AddChannelKeysDto) {
    return this.keyPool.addBatch(id, dto.keys, dto.weight);
  }

  @Roles('ADMIN')
  @Post('channels/:id/keys/bulk-delete')
  bulkRemoveKeys(@Param('id') id: string, @Body() dto: BulkRemoveChannelKeysDto) {
    return this.keyPool.bulkRemove(id, dto);
  }

  @Roles('ADMIN')
  @Post('channels/:id/keys/:keyId/test')
  async testKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return this.models.testChannel(id, await this.keyPool.revealForTest(id, keyId));
  }

  @Roles('ADMIN')
  @Patch('channels/:id/keys/:keyId')
  updateKey(@Param('id') id: string, @Param('keyId') keyId: string, @Body() dto: UpdateChannelKeyDto) {
    return this.keyPool.update(id, keyId, dto);
  }

  @Roles('ADMIN')
  @Delete('channels/:id/keys/:keyId')
  removeKey(@Param('id') id: string, @Param('keyId') keyId: string) {
    return this.keyPool.remove(id, keyId);
  }

  @Roles('ADMIN')
  @Patch('channels/:id')
  updateChannel(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.models.updateChannel(id, dto);
  }

  @Roles('ADMIN')
  @Delete('channels/:id')
  removeChannel(@Param('id') id: string) {
    return this.models.removeChannel(id);
  }

  // ---------- 模型 ----------
  @Roles('ADMIN')
  @Get()
  listModels() {
    return this.models.listModels();
  }

  @Roles('ADMIN')
  @Post()
  createModel(@Body() dto: CreateModelDto) {
    return this.models.createModel(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  updateModel(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.models.updateModel(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  removeModel(@Param('id') id: string) {
    return this.models.removeModel(id);
  }

  @Roles('ADMIN')
  @Post(':id/channels')
  bindChannel(@Param('id') modelId: string, @Body() dto: BindChannelDto) {
    return this.models.bindChannel(modelId, dto);
  }

  @Roles('ADMIN')
  @Delete(':id/channels/:channelId')
  unbindChannel(@Param('id') modelId: string, @Param('channelId') channelId: string) {
    return this.models.unbindChannel(modelId, channelId);
  }
}
