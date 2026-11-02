import { IsString, Length } from 'class-validator';

export class LoginDto {
  /** 邮箱或用户名 */
  @IsString()
  @Length(3, 64)
  account: string;

  @IsString()
  @Length(6, 32)
  password: string;
}
