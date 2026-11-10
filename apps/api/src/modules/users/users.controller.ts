import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChangePasswordDto, SetStatusDto, UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch('profile')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }

  @Get('logins')
  ownLoginLogs(@CurrentUser() user: AuthUser, @Query('page') page = 1, @Query('pageSize') pageSize = 4) {
    return this.users.ownLoginLogs(user.id, Number(page), Number(pageSize));
  }

  @Roles('ADMIN')
  @Get()
  list(@Query() query: Record<string,unknown>) {
    return this.users.list(query);
  }

  @Roles('ADMIN')
  @Get(':id')
  detail(@Param('id') id: string) { return this.users.detail(id); }

  @Roles('ADMIN')
  @Get(':id/activity')
  activity(@Param('id') id: string,@Query() query: Record<string,unknown>) { return this.users.activity(id,query); }

  @Roles('ADMIN')
  @Patch(':id/status')
  setStatus(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.users.setStatus(id, dto.status, me.id, dto.expectedUpdatedAt);
  }

  @Roles('ADMIN')
  @Get(':id/logins')
  loginLogs(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    return this.users.listLoginLogs(id, Number(page), Number(pageSize));
  }

  @Roles('ADMIN')
  @Post(':id/kick')
  kick(@Param('id') id: string) {
    return this.users.kickOffline(id);
  }
}
