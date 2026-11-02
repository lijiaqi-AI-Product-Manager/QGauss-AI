import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const CHANNEL_TYPES = ['OPENAI', 'OPENAI_RESPONSES', 'ANTHROPIC', 'GEMINI', 'CUSTOM', 'MOCK'] as const;

export class CreateChannelDto {
  @IsString() name: string;

  @IsIn(CHANNEL_TYPES as unknown as string[])
  type: (typeof CHANNEL_TYPES)[number];

  @IsString() baseUrl: string;

  /** 明文只在写入时传入；读取永远只返回掩码 */
  @IsOptional() @IsString() apiKey?: string;

  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsInt() @Min(0) weight?: number;
  @IsOptional() @IsInt() @Min(1000) timeoutMs?: number;
  @IsOptional() extra?: Record<string, unknown>;
}

/** 渠道 Key 池：批量导入（前端把多行文本拆成数组） */
export class AddChannelKeysDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  keys: string[];

  @IsOptional() @IsInt() @Min(1) @Max(100) weight?: number;
}

export class UpdateChannelKeyDto {
  @IsOptional() @IsIn(['ENABLED', 'DISABLED']) status?: 'ENABLED' | 'DISABLED';
  @IsOptional() @IsInt() @Min(1) @Max(100) weight?: number;
}

export class BulkRemoveChannelKeysDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) ids?: string[];
  /** 删除全部已禁用的 Key */
  @IsOptional() @IsBoolean() disabledOnly?: boolean;
}

export class UpdateChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(CHANNEL_TYPES as unknown as string[]) type?: any;
  @IsOptional() @IsString() baseUrl?: string;

  /** 留空表示不修改密钥 */
  @IsOptional() @IsString() apiKey?: string;

  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsInt() @Min(0) weight?: number;
  @IsOptional() @IsInt() @Min(1000) timeoutMs?: number;
  @IsOptional() @IsIn(['ENABLED', 'DISABLED']) status?: 'ENABLED' | 'DISABLED';
  @IsOptional() extra?: Record<string, unknown>;
}

export class CreateModelDto {
  @IsString() name: string;
  @IsString() displayName: string;

  /** 模型广场展示元数据：厂商 / 一句话介绍 / 标签（逗号分隔）/ 角标 */
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() badge?: string;

  @IsOptional() @IsInt() @Min(1024) maxContext?: number;
  @IsOptional() @IsInt() @Min(1) maxOutput?: number;
  @IsOptional() @IsString() capabilities?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) priceInPerM?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) priceOutPerM?: number;
  @IsOptional() @IsInt() sort?: number;
  /** 计费次数池：model3 | model4 | drawMj | agent；空串表示只记 token 成本、不扣次数 */
  @IsOptional() @IsIn(['', 'model3', 'model4', 'drawMj', 'agent']) countPool?: string;
  /** 每次对话消耗几次（配合 countPool 使用，0 表示不扣） */
  @IsOptional() @IsInt() @Min(0) countCost?: number;
}

export class UpdateModelDto {
  @IsOptional() @IsString() displayName?: string;

  /** 模型广场展示元数据：厂商 / 一句话介绍 / 标签（逗号分隔）/ 角标 */
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() badge?: string;

  @IsOptional() @IsInt() @Min(1024) maxContext?: number;
  @IsOptional() @IsInt() @Min(1) maxOutput?: number;
  @IsOptional() @IsString() capabilities?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) priceInPerM?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) priceOutPerM?: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsIn(['ENABLED', 'DISABLED']) status?: 'ENABLED' | 'DISABLED';
  /** 计费次数池：model3 | model4 | drawMj | agent；空串表示只记 token 成本、不扣次数 */
  @IsOptional() @IsIn(['', 'model3', 'model4', 'drawMj', 'agent']) countPool?: string;
  /** 每次对话消耗几次（配合 countPool 使用，0 表示不扣） */
  @IsOptional() @IsInt() @Min(0) countCost?: number;
}

export class BindChannelDto {
  @IsString() channelId: string;

  /** 该渠道上的真实模型名（Azure 是部署名） */
  @IsString() upstreamName: string;

  @IsOptional() @IsInt() @Min(0) weight?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
