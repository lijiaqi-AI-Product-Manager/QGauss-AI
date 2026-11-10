import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {UserAccountControlsService} from './account-controls.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService,UserAccountControlsService],
  exports: [UsersService],
})
export class UsersModule {}
