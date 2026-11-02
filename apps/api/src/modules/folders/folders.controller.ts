import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { FoldersService } from './folders.service';

class CreateFolderDto {
  @IsString() @Length(1, 32) name: string;
  @IsOptional() @IsInt() sort?: number;
}

class UpdateFolderDto {
  @IsOptional() @IsString() @Length(1, 32) name?: string;
  @IsOptional() @IsInt() sort?: number;
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
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.folders.remove(user.id, id);
  }
}
