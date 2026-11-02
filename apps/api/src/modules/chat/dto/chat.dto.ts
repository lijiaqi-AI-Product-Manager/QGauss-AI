import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

class ChatMessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @IsString()
  content: string;

  /** 附件（上传接口返回的文件 id）：图片走识图，文档解析成文本并入上下文 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  attachments?: string[];
}

export class ChatCompletionDto {
  @IsOptional() @IsString() @Length(1,128) agentId?:string;
  @IsOptional() @IsString() @Length(1,128) agentParentId?:string;
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) agentOfferRevision?:string;
  @Transform(({obj,key})=>obj[key])
  @ValidateIf((_object,value)=>value!==undefined)
  @IsBoolean()
  webSearch?: boolean;

  /** 不传则新建会话 */
  @IsOptional()
  @IsString()
  conversationId?: string;

  /** 前端生成的幂等键，挡住重复提交 */
  @IsOptional()
  @IsString()
  clientMsgId?: string;

  /** 从智能体应用进入时带上：注入 systemPrompt 并使用应用默认模型 */
  @IsOptional()
  @IsString()
  appId?: string;

  @Transform(({obj,key})=>obj[key]) @ValidateIf((_o,v)=>v!==undefined) @IsInt() @Min(1) @Max(2147483647) appVersion?:number;

  /** 重新生成：传入要重生成的助手消息 id，会挂在其父节点下形成分支 */
  @IsOptional()
  @IsString()
  regenerateOf?: string;

  /** 不传时依次回落：会话保存的模型 → 应用默认模型 → 站点默认模型 */
  @IsOptional()
  @IsString()
  model?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTokens?: number;
}
