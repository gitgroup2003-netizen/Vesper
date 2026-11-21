import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

export interface TranscodeReady {
  hlsUrl: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
}

export interface SubmitResult {
  providerId: string;
  /** Set by adapters that finish synchronously (dev). Otherwise the result arrives via webhook. */
  ready?: TranscodeReady;
}

export interface TranscodeEvent {
  videoId: string;
  providerId: string;
  state: 'ready' | 'error';
  ready?: TranscodeReady;
  reason?: string;
}

/** Port: swap Cloudflare Stream / Mux / self-hosted FFmpeg workers without touching the videos module. */
export abstract class Transcoder {
  abstract submit(input: { videoId: string; sourceKey: string; sourceUrl: string }): Promise<SubmitResult>;
  /** Verify + parse a provider webhook. Returns null when the payload is not actionable. */
  abstract parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): TranscodeEvent | null;
}
export const TRANSCODER = Symbol('TRANSCODER');

/** Local dev: skips transcoding and plays the raw MP4 straight from object storage. */
@Injectable()
export class DevTranscoder extends Transcoder {
  async submit(input: { videoId: string; sourceKey: string }): Promise<SubmitResult> {
    return {
      providerId: `dev-${input.videoId}`,
      ready: { hlsUrl: `${config.s3.publicBaseUrl}/${input.sourceKey}`, thumbnailUrl: null, durationMs: null },
    };
  }
  parseWebhook(): TranscodeEvent | null {
    return null;
  }
}

interface CfWebhookBody {
  uid: string;
  readyToStream?: boolean;
  status?: { state?: string; errorReasonText?: string };
  meta?: { videoId?: string };
  duration?: number;
  thumbnail?: string;
}

@Injectable()
export class CloudflareStreamTranscoder extends Transcoder {
  private readonly log = new Logger('CloudflareStream');
  private readonly base = `https://api.cloudflare.com/client/v4/accounts/${config.cf.accountId}/stream`;

  async submit(input: { videoId: string; sourceUrl: string }): Promise<SubmitResult> {
    const res = await fetch(`${this.base}/copy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.cf.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: input.sourceUrl,
        meta: { videoId: input.videoId },
        maxDurationSeconds: 180,
        requireSignedURLs: false,
      }),
    });
    const json = (await res.json()) as { success: boolean; result?: { uid: string }; errors?: unknown };
    if (!res.ok || !json.success || !json.result) {
      this.log.error(`Stream copy failed: ${JSON.stringify(json.errors)}`);
      throw new Error('stream_copy_failed');
    }
    return { providerId: json.result.uid };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): TranscodeEvent | null {
    this.verifySignature(headers['webhook-signature'], rawBody);
    const body = JSON.parse(rawBody) as CfWebhookBody;
    const videoId = body.meta?.videoId;
    if (!videoId) return null;
    const state = body.status?.state;
    if (state === 'error') {
      return { videoId, providerId: body.uid, state: 'error', reason: body.status?.errorReasonText ?? 'transcode_error' };
    }
    if (body.readyToStream && state === 'ready') {
      const root = `https://${config.cf.customerCode}.cloudflarestream.com/${body.uid}`;
      return {
        videoId,
        providerId: body.uid,
        state: 'ready',
        ready: {
          hlsUrl: `${root}/manifest/video.m3u8`,
          thumbnailUrl: `${root}/thumbnails/thumbnail.jpg?time=0s&height=720`,
          durationMs: body.duration && body.duration > 0 ? Math.round(body.duration * 1000) : null,
        },
      };
    }
    return null; // intermediate states (queued, downloading, inprogress)
  }

  /** Header format: `time=<unix>,sig1=<hex>`; signed string is `${time}.${rawBody}` (HMAC-SHA256). */
  private verifySignature(header: string | string[] | undefined, rawBody: string): void {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new UnauthorizedException({ code: 'missing_signature' });
    const parts = Object.fromEntries(value.split(',').map((p) => p.split('=') as [string, string]));
    const time = Number(parts.time);
    const sig = parts.sig1;
    if (!time || !sig || Math.abs(Date.now() / 1000 - time) > 300) throw new UnauthorizedException({ code: 'stale_signature' });
    const expected = createHmac('sha256', config.cf.webhookSecret).update(`${time}.${rawBody}`).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException({ code: 'bad_signature' });
  }
}
