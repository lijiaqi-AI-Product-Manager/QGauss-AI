import { IsBoolean, IsInt, IsOptional, IsString, Length } from 'class-validator';

export class CreateMenuDto {
  @IsOptional() @IsString() parentId?: string | null;
  @IsString() @Length(1, 32) title: string;
  @IsString() @Length(1, 200) path: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() visible?: boolean;
  @IsOptional() @IsString() roles?: string;
}

export class UpdateMenuDto {
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() @Length(1, 32) title?: string;
  @IsOptional() @IsString() @Length(1, 200) path?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() visible?: boolean;
  @IsOptional() @IsString() roles?: string;
}
