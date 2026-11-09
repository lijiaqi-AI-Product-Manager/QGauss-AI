import {Transform} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsInt,IsString,IsUUID,Length,Max,Min} from 'class-validator';
export class ChatUploadKeyDto{@IsUUID('4') key:string;}
export class ChatUploadBodyDto{
 @Transform(({obj,key})=>{const value=obj[key];return typeof value==='string'&&/^\d{1,10}$/.test(value)?Number(value):value;}) @IsInt() @Min(0) @Max(2147483646) expectedVersion:number;
}
export class CheckAttachmentsDto{
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @ArrayUnique() @IsString({each:true}) @Length(1,128,{each:true}) ids:string[];
}
