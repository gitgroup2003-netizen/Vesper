import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideosController, WebhooksController } from './videos.controller';
import { VideosService } from './videos.service';
import { CloudflareStreamTranscoder, DevTranscoder, TRANSCODER } from './transcoder';
import { AutoApproveModerator, MODERATOR } from './moderation';
import { config } from '../config';

@Module({
  imports: [AuthModule],
  controllers: [VideosController, WebhooksController],
  providers: [
    VideosService,
    { provide: TRANSCODER, useClass: config.transcoder === 'cloudflare' ? CloudflareStreamTranscoder : DevTranscoder },
    { provide: MODERATOR, useClass: AutoApproveModerator },
  ],
})
export class VideosModule {}
