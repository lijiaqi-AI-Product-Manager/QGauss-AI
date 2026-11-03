import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
const Raw=()=>Transform(({obj,key})=>obj[key]);
export const VOICE_IDS = ['alloy','echo','fable','nova','onyx','shimmer'] as const;
export class VoiceConfigDto {
  @Raw() @IsInt() @Min(0) version:number;
  @Raw() @IsBoolean() enabled:boolean;
  @Raw() @IsString() @MaxLength(128) speechChannelId:string;
  @Raw() @IsString() @MaxLength(128) transcriptionChannelId:string;
  @Raw() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/) speechModel:string;
  @Raw() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/) transcriptionModel:string;
  @Raw() @IsInt() @Min(0) @Max(1000000) speechCost:number;
  @Raw() @IsInt() @Min(0) @Max(1000000) transcriptionCost:number;
  @Raw() @IsIn(['model3','model4','drawMj','agent']) pool:string;
  @Raw() @IsInt() @Min(100) @Max(32768) maxSpeechChars:number;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsInt() @Min(0) @Max(3650) retentionDays?:number;
}
export class VoiceQuoteDto {
  @Raw() @IsIn(['speech','transcription']) kind:'speech'|'transcription';
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsString() @MaxLength(32768) text?:string;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsString() @MaxLength(80) title?:string;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsString() @MaxLength(128) messageId?:string;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsString() @MaxLength(128) fileId?:string;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsBoolean() sample?:boolean;
  @Raw() @ValidateIf((_,value)=>value!==undefined) @IsIn([...VOICE_IDS]) voice?:string;
}
export class VoiceCreateDto extends VoiceQuoteDto {
  @Raw() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) requestKey:string;
  @Raw() @IsString() @Matches(/^[a-f0-9]{64}$/) quoteRevision:string;
}
