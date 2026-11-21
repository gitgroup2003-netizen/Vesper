import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../infra/infra.module';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import { EventBatchDto } from './events.dto';

/** Telemetry ingest: append to a capped Redis Stream. Consumers (ClickHouse sink, ranker trainer) arrive in M4. */
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Post('batch')
  @HttpCode(202)
  async batch(@CurrentUser() user: AuthUser, @Body() dto: EventBatchDto): Promise<{ accepted: number }> {
    const pipe = this.redis.pipeline();
    for (const e of dto.events) {
      pipe.xadd(
        'telemetry:watch', 'MAXLEN', '~', 1_000_000, '*',
        'u', user.id, 'v', e.videoId, 't', e.type, 'ts', String(e.ts), 's', e.sessionId,
        'pos', String(e.positionMs ?? ''), 'w', String(e.watchedMs ?? ''), 'd', String(e.durationMs ?? ''), 'l', String(e.loops ?? ''),
      );
    }
    await pipe.exec();
    return { accepted: dto.events.length };
  }
}
