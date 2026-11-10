import { IsBoolean, IsIn, IsISO8601, IsObject, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class AccountActionDto {
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @IsISO8601({strict:true})
  @MaxLength(40)
  expectedUpdatedAt: string;

  @Transform(({obj,key})=>obj[key])
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/)
  requestKey: string;
}

export class ManagementDetailsDto extends AccountActionDto {
  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsBoolean()
  isDistribution?: boolean;
}

export class SessionActionDto extends AccountActionDto {
  @IsIn(['one','all','others'])
  scope: 'one' | 'all' | 'others';

  @Transform(({obj,key})=>obj[key])
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedRevision: string;

  @ValidateIf((_object,value)=>value!==undefined)
  @Transform(({obj,key})=>obj[key])
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  sessionId?: string;
}

export class ResolveAccountActionDto {
  @IsIn(['metadata','session','all','others'])
  kind:'metadata'|'session'|'all'|'others';

  @IsObject()
  payload:Record<string,unknown>;
}
