import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateWordDto {
  @IsString()
  @Length(1, 64)
  word: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['block', 'review'])
  action?: 'block' | 'review';
}

export class UpdateWordDto {
  @IsOptional() @IsString() @Length(1, 64) word?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsIn(['block', 'review']) action?: 'block' | 'review';
  @IsOptional() @IsBoolean() enabled?: boolean;
}
