import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {OptionalAuth} from '../../common/decorators/optional-auth.decorator';
import { AppsService } from './apps.service';
import {AppCreatorService} from './app-creator.service';
import {AppActionDto,CreateOwnedAppDto,ReviewOwnedAppDto,UpdateOwnedAppDto} from './dto/creator-app.dto';
import {
  CreateAppDto,
  CreateCategoryDto,
  FavoriteAppDto,
  UpdateAppDto,
  UpdateCategoryDto,
} from './dto/app.dto';

@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService,private readonly creator:AppCreatorService) {}

  @Get('mine') mine(@CurrentUser() user:AuthUser,@Query('view') view?:string){return this.creator.listMine(user.id,view);}
  @Get('mine/by-request/:key') createdByRequest(@CurrentUser() user:AuthUser,@Param('key') key:string){return this.creator.byRequest(user.id,key);}
  @Get('mine/:id') ownedDetail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.creator.mine(user.id,id);}
  @Post('mine') createOwned(@CurrentUser() user:AuthUser,@Body() dto:CreateOwnedAppDto){return this.creator.create(user.id,dto);}
  @Put('mine/:id') updateOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:UpdateOwnedAppDto){return this.creator.update(user.id,id,dto);}
  @Post('mine/:id/submit') submitOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.action(user.id,id,dto,'submit');}
  @Post('mine/:id/withdraw') withdrawOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.action(user.id,id,dto,'withdraw');}
  @Post('mine/:id/trash') trashOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.action(user.id,id,dto,'trash');}
  @Post('mine/:id/restore') restoreOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.action(user.id,id,dto,'restore');}
  @Post('mine/:id/reconcile') reconcileOwned(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.reconcile(user.id,id,dto);}
  @OptionalAuth() @Get('shared/:shareId') shared(@CurrentUser() user:AuthUser|undefined,@Param('shareId') id:string){return this.creator.shared(user?.id,id);}
  @Roles('ADMIN') @Get('admin/review') reviewList(@Query('status') status?:string,@Query('page') page?:string,@Query('pageSize') size?:string){return this.creator.reviews(status,page,size);}
  @Roles('ADMIN') @Get('admin/review/:id') reviewDetail(@Param('id') id:string){return this.creator.reviewDetail(id);}
  @Roles('ADMIN') @Post('admin/review/:id') review(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:ReviewOwnedAppDto){return this.creator.review(user.id,id,dto);}
  @Roles('ADMIN') @Post('admin/review/:id/reconcile') reconcileReview(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AppActionDto){return this.creator.reconcile(user.id,id,dto,true);}

  // ---------- 前台 ----------
  @OptionalAuth() @Get('categories')
  listCategories() {
    return this.apps.listCategories();
  }

  @OptionalAuth() @Get()
  list(@CurrentUser() user: AuthUser|undefined, @Query('categoryId') categoryId?: string) {
    return this.apps.listPublished(user?.id, categoryId);
  }

  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.apps.listFavorites(user.id);
  }

  @OptionalAuth() @Get(':id')
  detail(@CurrentUser() user: AuthUser|undefined, @Param('id') id: string) {
    return this.apps.detail(id, user?.id);
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
