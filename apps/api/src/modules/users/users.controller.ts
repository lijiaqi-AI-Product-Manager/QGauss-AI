import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChangePasswordDto, SetStatusDto, UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';
import {UserAccountControlsService} from './account-controls.service';
import {ManagementDetailsDto,SessionActionDto,ResolveAccountActionDto} from './dto/account-controls.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService,private readonly controls:UserAccountControlsService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.users.profile(user.id);
  }

  @Patch('profile')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto, user);
  }

  @Post('password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }

  @Get('logins')
  ownLoginLogs(@CurrentUser() user: AuthUser, @Query('page') page = 1, @Query('pageSize') pageSize = 4) {
    return this.users.ownLoginLogs(user.id, Number(page), Number(pageSize));
  }

  @Get('sessions')
  ownSessions(@CurrentUser() user:AuthUser,@Query() query:Record<string,unknown>){return this.controls.sessions(user.id,query,user,true);}

  @Post('session-actions')
  ownSessionAction(@CurrentUser() user:AuthUser,@Body() dto:SessionActionDto){return this.controls.endSessions(user.id,dto,user,true);}

  @Post('account-actions/resolve')
  ownResolveAction(@CurrentUser() user:AuthUser,@Body() dto:ResolveAccountActionDto){return this.controls.resolveAction(user.id,dto,user,true);}

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
  @Get(':id/sessions')
  sessions(@Param('id') id:string,@Query() query:Record<string,unknown>,@CurrentUser() user:AuthUser){return this.controls.sessions(id,query,user);}

  @Roles('ADMIN')
  @Patch(':id/management')
  updateManagement(@Param('id') id:string,@Body() dto:ManagementDetailsDto,@CurrentUser() user:AuthUser){return this.controls.updateManagement(id,dto,user);}

  @Roles('ADMIN')
  @Post(':id/session-actions')
  sessionAction(@Param('id') id:string,@Body() dto:SessionActionDto,@CurrentUser() user:AuthUser){return this.controls.endSessions(id,dto,user);}

  @Roles('ADMIN')
  @Post(':id/account-actions/resolve')
  resolveAction(@Param('id') id:string,@Body() dto:ResolveAccountActionDto,@CurrentUser() user:AuthUser){return this.controls.resolveAction(id,dto,user);}

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
  kick(@Param('id') id: string,@CurrentUser() user:AuthUser) {
    return this.controls.kickOffline(id,user);
  }
}
