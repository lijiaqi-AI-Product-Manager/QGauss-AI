import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateWordDto, UpdateWordDto } from './dto/word.dto';
import { ModerationService } from './moderation.service';

@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Roles('ADMIN')
  @Get('words')
  listWords() {
    return this.moderation.listWords();
  }

  @Roles('ADMIN')
  @Post('words')
  createWord(@Body() dto: CreateWordDto) {
    return this.moderation.createWord(dto);
  }

  @Roles('ADMIN')
  @Patch('words/:id')
  updateWord(@Param('id') id: string, @Body() dto: UpdateWordDto) {
    return this.moderation.updateWord(id, dto);
  }

  @Roles('ADMIN')
  @Delete('words/:id')
  removeWord(@Param('id') id: string) {
    return this.moderation.removeWord(id);
  }

  @Roles('ADMIN')
  @Get('hits')
  listHits(@Query('page') page = 1, @Query('pageSize') pageSize = 20) {
    return this.moderation.listHits(Number(page), Number(pageSize));
  }
}
