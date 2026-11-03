import {Body,Controller,Get,Header,Param,Post,Query} from '@nestjs/common';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {MindmapEndMutationDto,MindmapGenerationDto,MindmapGenerationQuoteDto,MindmapMutationDto,MindmapPageDto} from './mindmap.dto';
import {MindmapDocumentsService} from './mindmap-documents.service';
import {MindmapGenerationsService} from './mindmap-generations.service';

@Controller('mindmap')
export class MindmapController {
 constructor(private readonly documents:MindmapDocumentsService,private readonly generations:MindmapGenerationsService){}
 @Get('options') @Header('Cache-Control','private, no-store')
 options(){return this.generations.options();}
 @Get('documents') @Header('Cache-Control','private, no-store')
 list(@CurrentUser() user:AuthUser,@Query() query:MindmapPageDto){return this.documents.list(user.id,query);}
 @Get('documents/:id') @Header('Cache-Control','private, no-store')
 document(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.documents.get(user.id,id);}
 @Post('mutations') @Header('Cache-Control','private, no-store')
 mutate(@CurrentUser() user:AuthUser,@Body() dto:MindmapMutationDto){return this.documents.mutate(user.id,dto);}
 @Get('mutations/:requestKey') @Header('Cache-Control','private, no-store')
 operation(@CurrentUser() user:AuthUser,@Param('requestKey') key:string){return this.documents.operation(user.id,key);}
 @Post('mutations/:requestKey/end') @Header('Cache-Control','private, no-store')
 endMutation(@CurrentUser() user:AuthUser,@Param('requestKey') key:string,@Body() dto:MindmapEndMutationDto){return this.documents.end(user.id,key,dto);}
 @Post('generations/quote') @Header('Cache-Control','private, no-store')
 quote(@CurrentUser() user:AuthUser,@Body() dto:MindmapGenerationQuoteDto){return this.generations.quote(user.id,dto);}
 @Post('generations') @Header('Cache-Control','private, no-store')
 generate(@CurrentUser() user:AuthUser,@Body() dto:MindmapGenerationDto){return this.generations.create(user.id,dto);}
 @Get('generations') @Header('Cache-Control','private, no-store')
 history(@CurrentUser() user:AuthUser,@Query() query:MindmapPageDto){return this.generations.list(user.id,query);}
 @Get('generations/by-request/:requestKey') @Header('Cache-Control','private, no-store')
 byRequest(@CurrentUser() user:AuthUser,@Param('requestKey') key:string){return this.generations.byRequest(user.id,key);}
 @Post('generations/requests/:requestKey/end') @Header('Cache-Control','private, no-store')
 endGeneration(@CurrentUser() user:AuthUser,@Param('requestKey') key:string){return this.generations.end(user.id,key);}
 @Get('generations/:id') @Header('Cache-Control','private, no-store')
 generation(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.generations.get(user.id,id);}
 @Post('generations/:id/cancel') @Header('Cache-Control','private, no-store')
 cancel(@CurrentUser() user:AuthUser,@Param('id') id:string){return this.generations.cancel(user.id,id);}
}
