import { Controller, Get, Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { AuthModule } from './auth/auth.module';
import { VideosModule } from './videos/videos.module';
import { FeedModule } from './feed/feed.module';
import { EventsModule } from './events/events.module';

@Controller()
class HealthController {
  @Get('health') health() { return { ok: true }; }
}

@Module({
  imports: [InfraModule, AuthModule, VideosModule, FeedModule, EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
