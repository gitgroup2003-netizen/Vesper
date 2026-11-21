import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { FeedService } from './feed.service';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('for-you')
  forYou(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(12), ParseIntPipe) limit = 12,
  ) {
    return this.feed.forYou(cursor, Math.min(Math.max(limit, 1), 30));
  }
}
