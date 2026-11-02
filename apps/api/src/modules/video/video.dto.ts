import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { VIDEO_PROFILES, VIDEO_STYLES,UPSCALE_MODELS } from './video-profiles';
const Raw = () => Transform(({ obj, key }) => obj[key]);
const Optional = () => ValidateIf((_, value) => value !== undefined);
export class VideoPresetDto {
  @Raw() @IsInt() @Min(0) @Max(2147483646) version: number;
  @Raw() @IsString() @Length(1, 60) name: string;
  @Raw() @IsIn([...VIDEO_PROFILES]) profile: string;
  @Raw() @IsString() @MaxLength(128) channelId: string;
  @Raw() @IsString() @MaxLength(128) upstreamModel: string;
  @Raw() @IsBoolean() enabled: boolean;
  @Raw() @IsInt() @Min(0) @Max(1000000) baseCost: number;
  @Raw() @IsInt() @Min(0) @Max(1000000) perSecondCost: number;
  @Raw() @IsIn(['model3', 'model4', 'drawMj', 'agent']) pool: string;
  @Raw() @IsInt() @Min(2) @Max(120) maxWaitMinutes: number;
  @Raw() @IsString() @MaxLength(500) publicBaseUrl: string;
}
export class VideoQuoteDto {
  @Raw() @IsString() @Length(1, 128) presetId: string;
  @Raw() @IsIn(['text', 'image', 'extend','reference','edit','upscale','lipsync']) mode: string;
  @Raw() @IsString() @MaxLength(4000) prompt: string;
  @Raw() @Optional() @IsString() @MaxLength(2000) negativePrompt?: string;
  @Raw() @IsString() @MaxLength(12) ratio: string;
  @Raw() @Optional() @IsString() @IsIn(['', '480p', '720p', '1080p', '4k']) resolution?: string;
  @Raw() @Optional() @IsInt() @Min(0) @Max(30) seconds?: number;
  @Raw() @Optional() @IsInt() @Min(0) @Max(4294967295) seed?: number;
  @Raw() @Optional() @IsBoolean() sound?: boolean;
  @Raw() @Optional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @Length(1, 128, { each: true }) imageIds?: string[];
  @Raw() @Optional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @Length(1, 128, { each: true }) videoIds?: string[];
  @Raw() @Optional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @Length(1, 128, { each: true }) audioIds?: string[];
  @Raw() @Optional() @IsNumber() @Min(1) @Max(4) upscaleFactor?:number;
  @Raw() @Optional() @IsIn(UPSCALE_MODELS) enhanceModel?:string;
  @Raw() @Optional() @IsIn(['cut_off','loop','bounce','silence','remap']) syncMode?:string;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(1) compression?:number;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(1) noise?:number;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(1) halo?:number;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(.1) grain?:number;
  @Raw() @Optional() @IsNumber() @Min(0) @Max(1) recoverDetail?:number;
  @Raw() @Optional() @IsString() @Length(1, 128) sourceTaskId?: string;
  @Raw() @Optional() @IsIn(['', ...VIDEO_STYLES.map(s => s.key)]) style?: string;
  @Raw() @Optional() @IsInt() @Min(1) @Max(4) motion?: number;
  @Raw() @Optional() @IsInt() @Min(5) @Max(25) guidanceScale?: number;
  @Raw() @Optional() @IsInt() @Min(1) @Max(24) frameRate?: number;
  @Raw() @Optional() @IsIn(['', 'left', 'right']) pan?: string;
  @Raw() @Optional() @IsIn(['', 'up', 'down']) tilt?: string;
  @Raw() @Optional() @IsIn(['', 'cw', 'ccw']) rotate?: string;
  @Raw() @Optional() @IsIn(['', 'in', 'out']) zoom?: string;
}
export class VideoCreateDto extends VideoQuoteDto {
  @Raw() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) requestKey: string;
  @Raw() @IsString() @Matches(/^[a-f0-9]{64}$/) quoteRevision: string;
}
export class VideoPublishDto { @Raw() @IsBoolean() published:boolean; @Optional() @Raw() @IsString() @Length(0,128) catId?:string; @Optional() @Raw() @IsString() @Length(20,40) expectedUpdatedAt?:string; }
