import {Transform,Type} from 'class-transformer';
import {ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsIn,IsInt,IsOptional,IsString,Length,Matches,Max,MaxLength,Min,ValidateIf,ValidateNested} from 'class-validator';
const text=({obj,key}:any)=>typeof obj[key]==='string'?obj[key].trim():obj[key];
const integer=({obj,key}:any)=>typeof obj[key]==='string'&&/^\d{1,10}$/.test(obj[key])?Number(obj[key]):obj[key];
export class HistoryFilterDto {
 @Transform(text) @IsIn(['chat','app','agent']) kind:'chat'|'app'|'agent'='chat';
 @Transform(text) @ValidateIf((_o,v)=>v!==undefined) @IsString() @MaxLength(120) q?:string;
 @Transform(text) @ValidateIf((_o,v)=>v!==undefined) @IsString() @MaxLength(128) folder?:string;
 @Transform(text) @IsIn(['active','trash']) scope:'active'|'trash'='active';
}
export class ConversationHistoryDto extends HistoryFilterDto {
 @Transform(integer) @IsInt() @Min(1) @Max(50) limit=40;
 @Transform(text) @IsOptional() @IsString() @MaxLength(1024) cursor?:string;
}
export class ConversationStatusDto {
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsString({each:true}) @Length(1,128,{each:true}) ids:string[];
 @Transform(text) @IsIn(['active','trash']) scope:'active'|'trash'='active';
}
export class ConversationVersionDto {
 @Transform(({obj,key})=>obj[key]) @IsInt() @Min(1) @Max(2147483646) expectedVersion:number;
}
export class OptionalConversationVersionDto {
 @Transform(({obj,key})=>obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsInt() @Min(1) @Max(2147483646) expectedVersion?:number;
}
export class ConversationTargetDto extends ConversationVersionDto {
 @Transform(text) @IsString() @Length(1,128) id:string;
}
export class ConversationPreviewDto extends HistoryFilterDto {
 @Transform(text) @IsIn(['selected','unpinned']) mode:'selected'|'unpinned';
 @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>ConversationTargetDto) targets?:ConversationTargetDto[];
}
export class ConversationRemovalDto extends ConversationPreviewDto {
 @IsString() @Matches(/^[a-f0-9]{64}$/) confirmation:string;
}
export class BulkConversationDto {
 @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({each:true}) @Length(1,128,{each:true}) ids?:string[];
 @Transform(({obj,key})=>obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsBoolean() unpinnedOnly?:boolean;
 @IsOptional() @ValidateNested() @Type(()=>ConversationRemovalDto) preview?:ConversationRemovalDto;
}
