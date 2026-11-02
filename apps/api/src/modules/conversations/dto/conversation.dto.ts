import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}

export class UpdateConversationDto {
  /** 保存本会话下次使用的模型；不允许用 null 清除选择。 */
  @Transform(({ obj, key }) => obj[key])
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  /** 移动到分组；传 null 表示移出分组 */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  folderId?: string | null;
}

/** 批量删除：ids 与 unpinnedOnly 二选一（都给时取并集） */
export class BulkRemoveConversationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids?: string[];

  /** 删除全部未置顶会话 */
  @IsOptional()
  @IsBoolean()
  unpinnedOnly?: boolean;
}
