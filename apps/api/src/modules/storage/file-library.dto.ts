import {Transform,Type} from 'class-transformer';
import {IsIn,IsInt,IsString,Length,Max,Min,ValidateIf} from 'class-validator';
export class FileVersionDto{
 @Transform(({obj,key})=>obj[key]) @IsInt() @Min(1) @Max(2147483646) expectedVersion:number;
}
export class FileLibraryDto{
 @ValidateIf((_,v)=>v!==undefined) @IsIn(['0','1']) library?:string;
 @ValidateIf((_,v)=>v!==undefined) @IsIn(['0','1']) trash?:string;
 @ValidateIf((_,v)=>v!==undefined) @IsIn(['all','image','file']) kind?:string;
 @ValidateIf((_,v)=>v!==undefined) @IsString() @Length(0,100) q?:string;
 @Type(()=>Number) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(1) @Max(10000) page?:number;
 @Type(()=>Number) @ValidateIf((_,v)=>v!==undefined) @IsInt() @Min(1) @Max(100) pageSize?:number;
}
