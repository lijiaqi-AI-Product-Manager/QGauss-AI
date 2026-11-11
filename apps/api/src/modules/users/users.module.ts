import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {UserAccountControlsService} from './account-controls.service';
import {StorageModule} from '../storage/storage.module';
import {UserAvatarController} from './avatar.controller';
import {UserAvatarService} from './avatar.service';
import {AvatarUploadGuard} from './avatar-upload.guard';

@Module({
  imports:[StorageModule],
  controllers: [UsersController,UserAvatarController],
  providers: [UsersService,UserAccountControlsService,UserAvatarService,AvatarUploadGuard],
  exports: [UsersService],
})
export class UsersModule {}
