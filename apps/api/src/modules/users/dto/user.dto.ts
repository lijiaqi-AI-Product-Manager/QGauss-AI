import { IsIn, IsOptional, IsString, IsISO8601, Length, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim() : obj[key])
  @IsString()
  @Length(1, 32)
  displayName?: string;

  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @MaxLength(300)
  signature?: string;

  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @IsISO8601({strict:true})
  @MaxLength(40)
  expectedUpdatedAt?: string;
}

export class ChangePasswordDto {
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 128)
  oldPassword: string;

  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(8, 32, { message: '新密码需 8-32 位' })
  newPassword: string;
}

export class SetStatusDto {
  @IsIn(['ACTIVE', 'DISABLED'])
  status: 'ACTIVE' | 'DISABLED';

  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @IsISO8601({strict:true})
  @MaxLength(40)
  expectedUpdatedAt?: string;
}
