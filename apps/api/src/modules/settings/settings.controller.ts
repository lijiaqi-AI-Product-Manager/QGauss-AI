import { Body, Controller, Get, Put } from '@nestjs/common';
import { Allow, IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator';
import { InstallationAllowed } from '../../common/decorators/installation-allowed.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

class ConfigItemDto {
  @IsString() key: string;

  /** 类型由配置注册表校验；这里必须放行，否则会被 whitelist 剥掉 */
  @Allow() value: unknown;
}

class SaveConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigItemDto)
  settings: ConfigItemDto[];
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @InstallationAllowed()
  @Get('public')
  publicConfig() {
    return this.settings.publicConfig();
  }

  @Roles('ADMIN')
  @Get()
  adminList() {
    return this.settings.adminList();
  }

  @Roles('ADMIN')
  @Put()
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveConfigDto) {
    if (dto.settings.length > 20) throw new BusinessException(ErrorCode.PARAM_INVALID, '设置页面已更新，请刷新页面后预览保存。', 409);
    return this.settings.setMany(dto.settings, user.id);
  }
}
