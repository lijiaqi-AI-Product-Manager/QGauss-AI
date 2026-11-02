import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppsService } from './apps.service';
import {
  CreateAppDto,
  CreateCategoryDto,
  FavoriteAppDto,
  UpdateAppDto,
  UpdateCategoryDto,
} from './dto/app.dto';

@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  // ---------- 前台 ----------
  @Get('categories')
  listCategories() {
    return this.apps.listCategories();
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('categoryId') categoryId?: string) {
    return this.apps.listPublished(user.id, categoryId);
  }

  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.apps.listFavorites(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apps.detail(id, user.id);
  }

  @Post(':id/favorite')
  toggleFavorite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FavoriteAppDto) {
    return this.apps.toggleFavorite(user.id, id, dto?.favorited);
  }

  // ---------- 后台 ----------
  @Roles('ADMIN')
  @Get('admin/list')
  adminList() {
    return this.apps.adminList();
  }

  @Roles('ADMIN')
  @Post('admin/categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.apps.createCategory(dto.name, dto.sort ?? 0);
  }

  @Roles('ADMIN')
  @Patch('admin/categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.apps.updateCategory(id, dto);
  }

  @Roles('ADMIN')
  @Delete('admin/categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.apps.removeCategory(id);
  }

  @Roles('ADMIN')
  @Post('admin/create')
  create(@Body() dto: CreateAppDto) {
    return this.apps.create(dto);
  }

  @Roles('ADMIN')
  @Patch('admin/:id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.apps.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete('admin/:id')
  remove(@Param('id') id: string) {
    return this.apps.remove(id);
  }
}
