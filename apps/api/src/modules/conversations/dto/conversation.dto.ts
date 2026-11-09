import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {BulkConversationDto,OptionalConversationVersionDto} from './history.dto';
const text=({obj,key}:any)=>typeof obj[key]==='string'?obj[key].trim():obj[key];

export class CreateConversationDto {
  @Transform(text)
  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @Length(1,128)
  modelId?: string;

  @Transform(text)
  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @Length(1,60)
  title?: string;

  @Transform(text)
  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @Length(1,128)
  folderId?: string;
}

export class UpdateConversationDto extends OptionalConversationVersionDto {
  /** 保存本会话下次使用的模型；不允许用 null 清除选择。 */
  @Transform(text)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1,128)
  modelId?: string;

  @Transform(text)
  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @Length(1,60)
  title?: string;

  @Transform(({obj,key})=>obj[key])
  @ValidateIf((_object,value)=>value!==undefined)
  @IsBoolean()
  pinned?: boolean;

  /** 移动到分组；传 null 表示移出分组 */
  @Transform(text)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Length(1,128)
  folderId?: string | null;
}

/** 批量删除：ids 与 unpinnedOnly 二选一（都给时取并集） */
export class BulkRemoveConversationsDto extends BulkConversationDto {}
