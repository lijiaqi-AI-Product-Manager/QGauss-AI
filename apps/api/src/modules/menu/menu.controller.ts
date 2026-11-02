import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto';
import { MenuService } from './menu.service';

@Controller('menus')
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  /** 当前用户可见的导航树 */
  @Get()
  tree(@CurrentUser() user: AuthUser) {
    return this.menus.treeFor(user.role);
  }

  @Roles('ADMIN')
  @Get('admin')
  all() {
    return this.menus.all();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateMenuDto) {
    return this.menus.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menus.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.menus.remove(id);
  }
}
