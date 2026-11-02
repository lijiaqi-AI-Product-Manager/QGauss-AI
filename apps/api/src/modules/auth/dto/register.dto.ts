import {
  IsByteLength,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @Length(3, 20, { message: '用户名需 3-20 位' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名只能包含字母、数字、下划线和短横线' })
  username: string;

  @IsString()
  @Transform(({ obj, key }) => obj[key])
  @IsByteLength(0, 72, { message: '密码中的多字节字符过多' })
  @Length(8, 32, { message: '密码需 8-32 位' })
  password: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;

  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaCode?: string;

  @IsOptional() @IsUUID('4') emailChallengeId?:string;
  @IsOptional() @Transform(({obj,key})=>obj[key]) @IsString() @Matches(/^\d{6}$/) emailCode?:string;
}
