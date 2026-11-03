import {Controller,Get,Header,Param,Query,Res} from '@nestjs/common';
import {Transform} from 'class-transformer';
import {IsOptional,IsString,Matches} from 'class-validator';
import type {Response} from 'express';
import {AuthUser,CurrentUser} from '../../common/decorators/current-user.decorator';
import {ImageEditorService} from './image-editor.service';

export class ImageEditorInputDto {
 @Transform(({obj,key})=>obj[key]) @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) sourceId:string;
 @IsOptional() @Transform(({obj,key})=>obj[key]) @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/) maskId?:string;
}

@Controller('image/editor')
export class ImageEditorController {
 constructor(private readonly editor:ImageEditorService){}
 @Get('inputs') @Header('Cache-Control','private, no-store')
 inputs(@CurrentUser() user:AuthUser,@Query() query:ImageEditorInputDto){return this.editor.inputs(user.id,query.sourceId,query.maskId);}
 @Get('files/:id')
 async file(@CurrentUser() user:AuthUser,@Param('id') id:string,@Res() response:Response){const file=await this.editor.file(user.id,id);response.setHeader('Content-Type',file.mime);response.setHeader('Content-Length',file.buffer.length);response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`);response.end(file.buffer);}
}
