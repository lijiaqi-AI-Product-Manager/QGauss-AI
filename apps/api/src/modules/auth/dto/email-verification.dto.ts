import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, Length, Matches } from 'class-validator';

export class RegistrationCodeDto {
  @IsEmail() @Length(3,254) email: string;
  @IsString() @Length(1,128) captchaId: string;
  @IsString() @Length(1,16) captchaCode: string;
}
export class ConfirmEmailDto {
  @IsUUID('4') challengeId: string;
  @Transform(({obj,key})=>obj[key]) @IsString() @Matches(/^\d{6}$/) code: string;
}
