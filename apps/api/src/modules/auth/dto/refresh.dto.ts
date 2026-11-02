import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MaxLength(512)
  refreshToken: string;
}

/** Refresh-token or valid access-token possession authorizes revoking that login family. */
export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}
