import {IsIn,IsInt,IsNotEmpty,IsOptional,IsString,Matches,Max,MaxLength,Min,ValidateIf} from 'class-validator';
import {Transform} from 'class-transformer';

export const MINDMAP_IDENTIFIER=/^[A-Za-z0-9_-]{1,128}$/;
export type MindmapMutationKind='create'|'edit'|'archive'|'restore';

export class MindmapMutationDto {
 @IsString() @Matches(MINDMAP_IDENTIFIER) requestKey:string;
 @IsIn(['create','edit','archive','restore']) kind:MindmapMutationKind;
 @ValidateIf(value=>value.kind!=='create') @IsString() @Matches(MINDMAP_IDENTIFIER) documentId?:string|null;
 @ValidateIf(value=>value.kind!=='create') @IsInt() @Min(1) @Max(2147483647) expectedVersion?:number;
 @ValidateIf(value=>['create','edit'].includes(value.kind)) @IsString() @MaxLength(100) title?:string;
 @ValidateIf(value=>['create','edit'].includes(value.kind)) @IsString() @IsNotEmpty() @MaxLength(60000) outline?:string;
}

export class MindmapEndMutationDto {
 @IsIn(['create','edit','archive','restore']) kind:MindmapMutationKind;
 @ValidateIf(value=>value.kind!=='create') @IsString() @Matches(MINDMAP_IDENTIFIER) documentId?:string|null;
}

export class MindmapGenerationQuoteDto {
 @IsString() @Matches(MINDMAP_IDENTIFIER) modelId:string;
 @IsString() @IsNotEmpty() @MaxLength(4000) prompt:string;
 @IsOptional() @IsString() @MaxLength(60000) context?:string;
}

export class MindmapGenerationDto extends MindmapGenerationQuoteDto {
 @IsString() @Matches(MINDMAP_IDENTIFIER) requestKey:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) quoteRevision:string;
}

export class MindmapPageDto {
 @IsOptional() @Transform(({value})=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(10000) page=1;
 @IsOptional() @Transform(({value})=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(24) pageSize=6;
 @IsOptional() @IsIn(['active','trash']) view:'active'|'trash'='active';
 @IsOptional() @IsString() @MaxLength(100) q='';
}
