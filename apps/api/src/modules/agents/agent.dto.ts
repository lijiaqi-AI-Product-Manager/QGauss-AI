import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class AgentListDto {
  @Type(()=>Number) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(1) @Max(10000) page?:number;
  @Type(()=>Number) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(1) @Max(50) pageSize?:number;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,100) q?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsIn(['0','1']) favorites?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsIn(['0','1']) ready?:string;
}
export class AgentFavoriteDto {
  @Transform(({obj,key})=>obj[key]) @IsBoolean() favorited:boolean;
}
export class ArtifactSaveDto{
 @Transform(({obj,key})=>obj[key]) @IsInt() @Min(0) @Max(2147483646) expectedVersion:number;
}
export class AgentConnectionDto {
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(1) @Max(2147483646) version?:number;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(1,64) name?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(8,2048) baseUrl?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsIn(['JWT','PAT']) authMode?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,256) appId?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,256) publicKeyId?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,16384) secret?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Matches(/^\d{0,64}$/) spaceId?:string;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsBoolean() enabled?:boolean;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(5000) @Max(180000) timeoutMs?:number;
}
export class AgentEditDto {
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(1,128) connectionId?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Matches(/^\d{1,64}$/) botId?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(1,64) name?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,2000) description?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,4000) greeting?:string;
  @ValidateIf((_,v)=>v!==undefined) @IsArray() @ArrayMaxSize(8) @IsString({each:true}) @Length(1,24,{each:true}) tags?:string[];
  @ValidateIf((_,v)=>v!==undefined) @IsArray() @ArrayMaxSize(6) @IsString({each:true}) @Length(1,400,{each:true}) suggestedQuestions?:string[];
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(0) @Max(1000000) countCost?:number;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsBoolean() published?:boolean;
  @Transform(({obj,key})=>obj[key]) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(-1000000) @Max(1000000) sort?:number;
}
export class AgentImportDto {
  @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @Matches(/^\d{1,64}$/,{each:true}) botIds:string[];
  @Transform(({obj,key})=>obj[key]) @IsInt() @Min(0) @Max(1000000) countCost:number;
}
