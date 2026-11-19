import {IsBoolean,IsInt,IsOptional,IsString,Length} from 'class-validator';
class MenuFields{
 @IsOptional() @IsString() parentId?:string|null;
 @IsOptional() @IsString() icon?:string;
 @IsOptional() @IsInt() sort?:number;
 @IsOptional() @IsBoolean() visible?:boolean;
 @IsOptional() @IsString() roles?:string;
 @IsOptional() @IsString() titleEn?:string;
 @IsOptional() @IsString() titleTw?:string;
 @IsOptional() @IsString() hint?:string;
 @IsOptional() @IsString() hintEn?:string;
 @IsOptional() @IsString() hintTw?:string;
 @IsOptional() @IsString() standardKey?:string;
 @IsOptional() @IsString() kind?:string;
 @IsOptional() @IsString() surface?:string;
 @IsOptional() @IsString() platform?:string;
 @IsOptional() @IsString() targetUrl?:string;
 @IsOptional() @IsBoolean() openInNewTab?:boolean;
 @IsOptional() @IsBoolean() requireLogin?:boolean;
 @IsOptional() @IsString() iconMode?:string;
 @IsOptional() @IsString() activeIcon?:string;
 @IsOptional() @IsString() iconUrl?:string;
 @IsOptional() @IsString() activeIconUrl?:string;
}
export class CreateMenuDto extends MenuFields{
 @IsString() @Length(1,80) title:string;
 @IsString() @Length(0,2048) path:string;
}
export class UpdateMenuDto extends MenuFields{
 @IsOptional() @IsString() @Length(1,80) title?:string;
 @IsOptional() @IsString() @Length(0,2048) path?:string;
}
