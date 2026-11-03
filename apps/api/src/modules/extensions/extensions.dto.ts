import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
export class ExtensionMutationDto {
    @IsUUID('4')
    requestKey: string;
    @Transform(({ obj, key }) => obj[key])
    @IsInt()
    @Min(0)
    @Max(2147483646)
    expectedVersion: number;
}
export class SaveExtensionDto extends ExtensionMutationDto {
    @IsString()
    @Length(1, 40)
    title: string;
    @IsString()
    @Length(0, 240)
    description: string;
    @IsString()
    @Length(1, 2000)
    entryUrl: string;
    @IsIn(['apps', 'image', 'chat', 'mindmap', 'palette', 'agent'])
    icon: string;
    @IsIn(['violet', 'lime', 'peach', 'sky'])
    tone: string;
    @Transform(({ obj, key }) => obj[key])
    @IsInt()
    @Min(-1000)
    @Max(1000)
    sort: number;
    @Transform(({ obj, key }) => obj[key])
    @IsBoolean()
    enabled: boolean;
    @IsIn(['USER,ADMIN', 'ADMIN'])
    roles: string;
    @Transform(({ obj, key }) => obj[key])
    @IsBoolean()
    chatEnabled: boolean;
    @Transform(({ obj, key }) => obj[key])
    @IsBoolean()
    legacyBridge: boolean;
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9_-]{1,128}$/)
    modelId?: string | null;
}
export class PrepareExtensionRequestDto {
    @IsUUID('4')
    requestKey: string;
    @IsString()
    @Length(1, 4000)
    prompt: string;
    @IsString()
    @Matches(/^[a-f0-9]{64}$/)
    quoteRevision: string;
}
