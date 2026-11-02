import { IsBoolean, IsInt, IsOptional, IsString, Length } from 'class-validator';

export class CreateGroupDto {
  @IsString() @Length(1, 32) name: string;
  @IsOptional() @IsInt() sort?: number;
}

export class UpdateGroupDto {
  @IsOptional() @IsString() @Length(1, 32) name?: string;
  @IsOptional() @IsInt() sort?: number;
}

export class CreatePresetDto {
  @IsOptional() @IsString() groupId?: string;
  @IsString() @Length(1, 64) title: string;
  @IsString() @Length(1, 8000) prompt: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sort?: number;
}

export class UpdatePresetDto {
  /** null 表示移出分组（@IsOptional 允许 null） */
  @IsOptional() @IsString() groupId?: string | null;
  @IsOptional() @IsString() @Length(1, 64) title?: string;
  @IsOptional() @IsString() @Length(1, 8000) prompt?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
