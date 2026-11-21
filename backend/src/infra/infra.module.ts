import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { config } from '../config';

export const PG = Symbol('PG');
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    { provide: PG, useFactory: () => new Pool({ connectionString: config.databaseUrl, max: 20 }) },
    { provide: REDIS, useFactory: () => new Redis(config.redisUrl, { maxRetriesPerRequest: 3 }) },
  ],
  exports: [PG, REDIS],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(@Inject(PG) private readonly pg: Pool, @Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pg.end(), this.redis.quit()]);
  }
}
