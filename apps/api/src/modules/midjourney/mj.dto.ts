import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { MJ_KINDS, MJ_ROLES, MJ_VERSIONS } from './mj-profiles';
const Raw=()=>Transform(({obj,key})=>obj[key]);
const Optional=()=>ValidateIf((_,v)=>v!==undefined);
export class MjPricesDto {
  @Raw() @IsInt() @Min(0) @Max(1000000) imagine:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) blend:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) describe:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) shorten:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) swap:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) upscale:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) variation:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) reroll:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) pan:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) outpaint:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) inpaint:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) video:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) video_extend:number;
}
export class MjPresetDto {
  @Raw() @IsInt() @Min(0) @Max(2147483646) version:number;
  @Raw() @IsString() @Length(1,60) name:string;
  @Raw() @IsIn(['PLUS','PROXY']) profile:string;
  @Raw() @IsIn(['MJ_SECRET','BEARER']) authMode:string;
  @Raw() @IsIn(['fast','relax','turbo']) speed:string;
  @Raw() @IsString() @MaxLength(128) channelId:string;
  @Raw() @IsBoolean() enabled:boolean;
  @Raw() @IsIn(['model3','model4','drawMj','agent']) pool:string;
  @Raw() @IsInt() @Min(2) @Max(120) maxWaitMinutes:number;
  @Raw() @IsInt() @Min(1) @Max(10) hdMultiplier:number;
  @Raw() @IsInt() @Min(1) @Max(10) highMotionMultiplier:number;
  @IsObject() @ValidateNested() @Type(()=>MjPricesDto) prices:MjPricesDto;
  @Raw() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @ArrayUnique() @IsIn([...MJ_VERSIONS],{each:true}) versions:string[];
  @Raw() @IsBoolean() video:boolean;
  @Raw() @IsBoolean() faceSwap:boolean;
  @Raw() @IsBoolean() niji:boolean;
  @Raw() @IsInt() @IsIn([5,6]) blendLimit:number;
}
export class MjReferenceDto {
  @Raw() @IsString() @Length(1,128) id:string;
  @Raw() @IsIn([...MJ_ROLES]) role:string;
}
export class MjQuoteDto {
  @Raw() @IsString() @Length(1,128) presetId:string;
  @Raw() @IsIn([...MJ_KINDS]) kind:string;
  @Raw() @IsString() @MaxLength(4000) prompt:string;
  @Raw() @Optional() @IsIn(['mj','niji']) model?:string;
  @Raw() @Optional() @IsIn([...MJ_VERSIONS]) version?:string;
  @Raw() @Optional() @IsString() @Matches(/^\d{1,4}:\d{1,4}$/) ratio?:string;
  @Raw() @Optional() @IsNumber() @IsIn([0,.25,.5,1,2,4]) quality?:number;
  @Raw() @Optional() @IsBoolean() hd?:boolean;
  @Raw() @Optional() @IsBoolean() raw?:boolean;
  @Raw() @Optional() @IsInt() @Min(0) @Max(1000) stylize?:number;
  @Raw() @Optional() @IsInt() @Min(0) @Max(100) chaos?:number;
  @Raw() @Optional() @IsInt() @Min(0) @Max(4294967295) seed?:number;
  @Raw() @Optional() @IsString() @MaxLength(2000) negativePrompt?:string;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(3) imageWeight?:number;
  @Raw() @Optional() @IsInt() @Min(0) @Max(1000) characterWeight?:number;
  @Raw() @Optional() @IsInt() @Min(0) @Max(1000) styleWeight?:number;
  @Optional() @IsArray() @ArrayMaxSize(8) @ValidateNested({each:true}) @Type(()=>MjReferenceDto) references?:MjReferenceDto[];
  @Raw() @Optional() @IsIn(['SQUARE','PORTRAIT','LANDSCAPE']) dimensions?:string;
  @Raw() @Optional() @IsString() @Length(1,128) sourceTaskId?:string;
  @Raw() @Optional() @IsString() @Matches(/^[a-f0-9]{32}$/) actionId?:string;
  @Raw() @Optional() @IsString() @Length(1,128) maskId?:string;
  @Raw() @Optional() @IsNumber() @Min(1) @Max(2) zoom?:number;
  @Raw() @Optional() @IsBoolean() remix?:boolean;
  @Raw() @Optional() @IsBoolean() strong?:boolean;
  @Raw() @Optional() @IsIn(['low','high']) motion?:string;
  @Raw() @Optional() @IsIn(['vid_1.1_i2v_480','vid_1.1_i2v_720']) videoType?:string;
  @Raw() @Optional() @IsInt() @IsIn([1,2,4]) batchSize?:number;
  @Raw() @Optional() @IsBoolean() loop?:boolean;
  @Raw() @Optional() @IsInt() @Min(0) @Max(3) sourceIndex?:number;
}
export class MjCreateDto extends MjQuoteDto {
  @Raw() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) requestKey:string;
  @Raw() @IsString() @Matches(/^[a-f0-9]{64}$/) quoteRevision:string;
}
export class MjModalDto {
  @Raw() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) requestKey:string;
  @Raw() @IsString() @Length(1,4000) prompt:string;
}
export class MjPublishDto { @Raw() @IsBoolean() published:boolean; }
