import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentConnectionDto, AgentEditDto, AgentFavoriteDto, AgentImportDto, AgentListDto } from './agent.dto';
import { AgentsService } from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents:AgentsService){}
  @Roles('ADMIN') @Get('admin/connections') connections(){return this.agents.connections();}
  @Roles('ADMIN') @Post('admin/connections') createConnection(@Body() dto:AgentConnectionDto){return this.agents.saveConnection(dto);}
  @Roles('ADMIN') @Patch('admin/connections/:id') updateConnection(@Param('id') id:string,@Body() dto:AgentConnectionDto){return this.agents.saveConnection(dto,id);}
  @Roles('ADMIN') @Delete('admin/connections/:id') removeConnection(@Param('id') id:string){return this.agents.removeConnection(id);}
  @Roles('ADMIN') @Post('admin/connections/:id/probe') probe(@Param('id') id:string){return this.agents.probe(id);}
  @Roles('ADMIN') @Get('admin/connections/:id/bots') discover(@Param('id') id:string,@Query() query:AgentListDto){return this.agents.discover(id,query.page||1);}
  @Roles('ADMIN') @Post('admin/connections/:id/import') import(@Param('id') id:string,@Body() dto:AgentImportDto){return this.agents.importBots(id,dto.botIds,dto.countCost);}
  @Roles('ADMIN') @Get('admin/list') listAdmin(){return this.agents.adminList();}
  @Roles('ADMIN') @Get('admin/receipts') receipts(){return this.agents.receipts();}
  @Roles('ADMIN') @Post('admin/bots') create(@Body() dto:AgentEditDto){return this.agents.saveAgent(dto);}
  @Roles('ADMIN') @Patch('admin/bots/:id') edit(@Param('id') id:string,@Body() dto:AgentEditDto){return this.agents.saveAgent(dto,id);}
  @Roles('ADMIN') @Post('admin/bots/:id/sync') sync(@Param('id') id:string){return this.agents.syncAgent(id);}
  @Roles('ADMIN') @Delete('admin/bots/:id') remove(@Param('id') id:string){return this.agents.removeAgent(id);}
  @Get() list(@CurrentUser() user:AuthUser,@Query() query:AgentListDto){return this.agents.list(user.id,query);}
  @Get(':id') detail(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.agents.detail(user.id,id);}
  @Post(':id/favorite') favorite(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:AgentFavoriteDto){return this.agents.favorite(user.id,id,dto.favorited);}
}
