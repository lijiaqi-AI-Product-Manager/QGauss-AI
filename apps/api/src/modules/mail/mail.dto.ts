import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAIL_STATES, MAIL_TEMPLATES } from './mail-receipt';

const optional = (_: unknown, value: unknown) => value !== undefined;
const integer = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => typeof obj[key] === 'string' && /^\d+$/.test(obj[key] as string) ? Number(obj[key]) : obj[key];
const choice = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key] === '' ? undefined : obj[key];

export class MailOutboxQuery {
  @Transform(integer) @IsInt() @Min(1) @Max(1_000_000)
  page = 1;
  @Transform(integer) @IsInt() @Min(1) @Max(100)
  pageSize = 20;
  @Transform(choice) @ValidateIf(optional) @IsIn(MAIL_STATES)
  status?: string;
  @Transform(choice) @ValidateIf(optional) @IsIn(MAIL_TEMPLATES)
  template?: string;
  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim() : obj[key])
  @ValidateIf(optional) @IsString() @MaxLength(120) @Matches(/^[^\u0000-\u001f\u007f]*$/)
  keyword?: string;
}

export class MailProbeDto {
  @Transform(({ obj, key }) => obj[key]) @IsUUID('4')
  requestKey: string;
}
