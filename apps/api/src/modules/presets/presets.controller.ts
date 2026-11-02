import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateGroupDto,
  CreatePresetDto,
  UpdateGroupDto,
  UpdatePresetDto,
} from './dto/preset.dto';
import { PresetsService } from './presets.service';

@Controller('presets')
export class PresetsController {
  constructor(private readonly presets: PresetsService) {}

  /** 前台快捷入口 */
  @Get()
  list() {
    return this.presets.listGrouped();
  }

  // ---------------- 后台 ----------------
  @Roles('ADMIN')
  @Get('admin')
  adminList() {
    return this.presets.adminList();
  }

  @Roles('ADMIN')
  @Get('groups')
  listGroups() {
    return this.presets.listGroups();
  }

  @Roles('ADMIN')
  @Post('groups')
  createGroup(@Body() dto: CreateGroupDto) {
    return this.presets.createGroup(dto);
  }

  @Roles('ADMIN')
  @Patch('groups/:id')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.presets.updateGroup(id, dto);
  }

  @Roles('ADMIN')
  @Delete('groups/:id')
  removeGroup(@Param('id') id: string) {
    return this.presets.removeGroup(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreatePresetDto) {
    return this.presets.createPreset(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePresetDto) {
    return this.presets.updatePreset(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.presets.removePreset(id);
  }
}
