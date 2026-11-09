import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsString, Length,ValidateIf,Min,Max } from 'class-validator';
import {Transform} from 'class-transformer';
import {OptionalConversationVersionDto} from '../conversations/dto/history.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { FoldersService } from './folders.service';

class CreateFolderDto {
  @Transform(({obj,key})=>typeof obj[key]==='string'?obj[key].trim():obj[key]) @IsString() @Length(1, 32) name: string;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsInt() @Min(-100000) @Max(100000) sort?: number;
}

class UpdateFolderDto extends OptionalConversationVersionDto {
  @Transform(({obj,key})=>typeof obj[key]==='string'?obj[key].trim():obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsString() @Length(1, 32) name?: string;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsInt() @Min(-100000) @Max(100000) sort?: number;
}

@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.folders.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFolderDto) {
    return this.folders.create(user.id, dto.name, dto.sort ?? 0);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.folders.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string,@Body() body:OptionalConversationVersionDto) {
    return this.folders.remove(user.id, id,body?.expectedVersion);
  }
}
