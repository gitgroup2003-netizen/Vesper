import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, AuthUser, JwtAuthGuard } from '../auth/auth.guard';
import { VideosService } from './videos.service';
import { CompleteUploadDto, CreateUploadDto } from './videos.dto';
import { TRANSCODER, Transcoder } from './transcoder';
import { Inject } from '@nestjs/common';

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post('uploads')
  createUpload(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadDto) {
    return this.videos.createUpload(user.id, dto);
  }

  @Get(':id/upload')
  uploadPlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.getUploadPlan(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteUploadDto) {
    return this.videos.completeUpload(user.id, id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.videos.get(user.id, id);
  }
}

/** Unauthenticated by design: authenticity comes from the provider's HMAC signature. */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly videos: VideosService,
    @Inject(TRANSCODER) private readonly transcoder: Transcoder,
  ) {}

  @Post('transcoder')
  @HttpCode(204)
  async transcoderWebhook(@Req() req: RawBodyRequest<FastifyRequest>, @Headers() headers: Record<string, string | string[] | undefined>): Promise<void> {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const event = this.transcoder.parseWebhook(headers, raw);
    if (event) await this.videos.handleTranscodeEvent(event);
  }
}
