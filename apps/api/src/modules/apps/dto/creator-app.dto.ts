import {Transform} from 'class-transformer';
import {IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,Min,ValidateIf} from 'class-validator';
const raw=({obj,key}:{obj:any;key:string})=>obj[key];
export class CreatorAppContentDto {
 @Transform(raw) @IsString() @Length(1,64) name:string;
 @Transform(raw) @IsString() @Length(0,240) description:string;
 @Transform(raw) @IsString() @Matches(/^(?:🪐|🎨|🧠|📝|🧭|💻|qgauss:app-icon:ai_[a-f\d]{48})$/u) icon:string;
 @Transform(raw) @IsString() @Length(1,8000) systemPrompt:string;
 @Transform(raw) @IsString() @Length(0,1000) greeting:string;
 @IsOptional() @Transform(raw) @IsString() @Length(1,128) defaultModel?:string|null;
 @IsOptional() @Transform(raw) @IsString() @Length(1,128) categoryId?:string|null;
 @IsUUID('4') requestKey:string;
}
export class CreateOwnedAppDto extends CreatorAppContentDto {}
export class AppActionDto {
 @Transform(raw) @IsInt() @Min(1) @Max(2147483646) version:number;
 @IsUUID('4') requestKey:string;
}
export class UpdateOwnedAppDto extends CreatorAppContentDto {
 @Transform(raw) @IsInt() @Min(1) @Max(2147483646) version:number;
}
export class ReviewOwnedAppDto extends AppActionDto {
 @IsIn(['APPROVE','REJECT','UNPUBLISH']) decision:'APPROVE'|'REJECT'|'UNPUBLISH';
 @Transform(raw) @IsString() @Length(0,500) note:string;
 @ValidateIf((o)=>o.decision==='APPROVE') @IsString() @Length(64,64) offerRevision?:string;
}
