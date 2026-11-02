import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

export class InitializeDto {
  @Transform(({ obj, key }) => obj[key])
  @IsUUID('4')
  requestKey: string;

  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim().toLowerCase() : obj[key])
  @IsEmail()
  @MaxLength(128)
  email: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(3, 20)
  @Matches(/^[A-Za-z0-9_-]+$/)
  username: string;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim() : obj[key])
  @IsString()
  @MaxLength(32)
  displayName?: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(12, 32)
  password: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @MaxLength(512)
  siteBaseUrl: string;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  openRegistration: boolean;
}
