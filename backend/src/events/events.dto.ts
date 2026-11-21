import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const EVENT_TYPES = ['impression', 'play', 'progress', 'loop', 'pause', 'skip', 'like', 'share', 'view_end'] as const;

export class WatchEventDto {
  @IsUUID() videoId: string;
  @IsIn(EVENT_TYPES as unknown as string[]) type: string;
  @IsInt() @Min(0) ts: number;
  @IsString() @MaxLength(64) sessionId: string;
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) positionMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) watchedMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) durationMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) loops?: number;
}

export class EventBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => WatchEventDto)
  events: WatchEventDto[];
}
