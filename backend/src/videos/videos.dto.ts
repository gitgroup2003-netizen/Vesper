import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUploadDto {
  @IsInt() @Min(1) sizeBytes: number;
  @IsIn(['video/mp4', 'video/quicktime']) contentType: string;
  @IsOptional() @IsInt() @Min(1) @Max(180_000) durationMs?: number;
  @IsOptional() @IsString() @MaxLength(2200) caption?: string;
}

export class PartDto {
  @IsInt() @Min(1) @Max(10_000) partNumber: number;
  @IsString() @MaxLength(200) etag: string;
}

export class CompleteUploadDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10_000) @ValidateNested({ each: true }) @Type(() => PartDto)
  parts: PartDto[];
}
