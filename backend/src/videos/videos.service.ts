import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, HeadObjectCommand,
  ListPartsCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG, REDIS } from '../infra/infra.module';
import { config } from '../config';
import { TRANSCODER, Transcoder, TranscodeEvent, TranscodeReady } from './transcoder';
import { MODERATOR, Moderator } from './moderation';
import type { CompleteUploadDto, CreateUploadDto } from './videos.dto';

interface VideoRow {
  id: string; author_id: string; status: string; caption: string; source_key: string; upload_id: string;
  size_bytes: string; duration_ms: number | null; hls_url: string | null; thumbnail_url: string | null;
  failure_reason: string | null; created_at: Date; published_at: Date | null;
}

export interface UploadPlan {
  videoId: string;
  partSize: number;
  totalParts: number;
  uploaded: { partNumber: number; etag: string }[];
  pending: { partNumber: number; url: string }[];
  expiresInSeconds: number;
}

@Injectable()
export class VideosService {
  private readonly log = new Logger(VideosService.name);
  private readonly s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    // Presigned UploadPart URLs must not carry checksum headers the mobile client won't send (R2/MinIO compat).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  constructor(
    @Inject(PG) private readonly pg: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(TRANSCODER) private readonly transcoder: Transcoder,
    @Inject(MODERATOR) private readonly moderator: Moderator,
  ) {}

  // ---------- Upload lifecycle ----------

  async createUpload(userId: string, dto: CreateUploadDto): Promise<UploadPlan> {
    if (dto.sizeBytes > config.upload.maxBytes) {
      throw new BadRequestException({ code: 'file_too_large', maxBytes: config.upload.maxBytes });
    }
    const key = `rl:upload:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 86_400);
    if (n > config.upload.maxPerDay) throw new HttpException({ code: 'daily_upload_limit' }, 429);

    const videoId = randomUUID();
    const sourceKey = `raw/${userId}/${videoId}.mp4`;
    const mp = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: config.s3.bucket, Key: sourceKey, ContentType: dto.contentType }),
    );
    if (!mp.UploadId) throw new BadGatewayException({ code: 'storage_unavailable' });

    await this.pg.query(
      `INSERT INTO videos (id, author_id, status, caption, source_key, upload_id, size_bytes, duration_ms)
       VALUES ($1, $2, 'UPLOADING', $3, $4, $5, $6, $7)`,
      [videoId, userId, dto.caption ?? '', sourceKey, mp.UploadId, dto.sizeBytes, dto.durationMs ?? null],
    );
    return this.buildPlan({ id: videoId, source_key: sourceKey, upload_id: mp.UploadId, size_bytes: String(dto.sizeBytes) }, []);
  }

  /** Resume support: report which parts R2 already has and re-presign the rest. */
  async getUploadPlan(userId: string, videoId: string): Promise<UploadPlan> {
    const v = await this.owned(userId, videoId);
    if (v.status !== 'UPLOADING') throw new ConflictException({ code: 'upload_not_active', status: v.status });
    const uploaded: { partNumber: number; etag: string }[] = [];
    let marker: string | undefined;
    do {
      const page = await this.s3.send(
        new ListPartsCommand({ Bucket: config.s3.bucket, Key: v.source_key, UploadId: v.upload_id, PartNumberMarker: marker }),
      );
      for (const p of page.Parts ?? []) if (p.PartNumber && p.ETag) uploaded.push({ partNumber: p.PartNumber, etag: p.ETag });
      marker = page.IsTruncated ? String(page.NextPartNumberMarker) : undefined;
    } while (marker);
    return this.buildPlan(v, uploaded);
  }

  private async buildPlan(
    v: Pick<VideoRow, 'id' | 'source_key' | 'upload_id' | 'size_bytes'>,
    uploaded: { partNumber: number; etag: string }[],
  ): Promise<UploadPlan> {
    const partSize = config.upload.partSizeBytes;
    const totalParts = Math.ceil(Number(v.size_bytes) / partSize);
    const have = new Set(uploaded.map((p) => p.partNumber));
    const pending: { partNumber: number; url: string }[] = [];
    for (let n = 1; n <= totalParts; n++) {
      if (have.has(n)) continue;
      const url = await getSignedUrl(
        this.s3,
        new UploadPartCommand({ Bucket: config.s3.bucket, Key: v.source_key, UploadId: v.upload_id, PartNumber: n }),
        { expiresIn: config.upload.urlTtlSeconds },
      );
      pending.push({ partNumber: n, url });
    }
    return { videoId: v.id, partSize, totalParts, uploaded, pending, expiresInSeconds: config.upload.urlTtlSeconds };
  }

  async completeUpload(userId: string, videoId: string, dto: CompleteUploadDto) {
    const v = await this.owned(userId, videoId);
    if (v.status !== 'UPLOADING') return this.toApi(v); // idempotent retry

    const parts = [...dto.parts].sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: config.s3.bucket, Key: v.source_key, UploadId: v.upload_id,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    } catch (e) {
      // A previous attempt may have completed it; the HeadObject below is the source of truth.
      if ((e as { name?: string }).name !== 'NoSuchUpload') {
        this.log.error(`complete failed for ${videoId}: ${String(e)}`);
        throw new BadRequestException({ code: 'invalid_parts' });
      }
    }

    const head = await this.s3
      .send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: v.source_key }))
      .catch(() => null);
    if (!head || Number(head.ContentLength) !== Number(v.size_bytes)) {
      await this.markFailed(videoId, 'size_mismatch', ['UPLOADING']);
      throw new BadRequestException({ code: 'size_mismatch' });
    }

    const moved = await this.pg.query<VideoRow>(
      `UPDATE videos SET status = 'PROCESSING' WHERE id = $1 AND status = 'UPLOADING' RETURNING *`,
      [videoId],
    );
    if (!moved.rowCount) return this.toApi(await this.owned(userId, videoId));

    try {
      const sourceUrl = await getSignedUrl(
        this.s3, new GetObjectCommand({ Bucket: config.s3.bucket, Key: v.source_key }), { expiresIn: 3600 },
      );
      const result = await this.transcoder.submit({ videoId, sourceKey: v.source_key, sourceUrl });
      await this.pg.query(`UPDATE videos SET provider_id = $2 WHERE id = $1`, [videoId, result.providerId]);
      if (result.ready) await this.onTranscodeReady(videoId, result.providerId, result.ready);
    } catch (e) {
      this.log.error(`transcode submit failed for ${videoId}: ${String(e)}`);
      await this.markFailed(videoId, 'transcode_submit_failed', ['PROCESSING']);
      throw new BadGatewayException({ code: 'transcode_submit_failed' });
    }
    return this.toApi(await this.owned(userId, videoId));
  }

  // ---------- Transcoder callbacks (idempotent: every transition is conditional on the current status) ----------

  async handleTranscodeEvent(ev: TranscodeEvent): Promise<void> {
    if (ev.state === 'error') {
      await this.markFailed(ev.videoId, ev.reason ?? 'transcode_error', ['PROCESSING']);
      return;
    }
    if (ev.ready) await this.onTranscodeReady(ev.videoId, ev.providerId, ev.ready);
  }

  private async onTranscodeReady(videoId: string, providerId: string, ready: TranscodeReady): Promise<void> {
    const moved = await this.pg.query<VideoRow>(
      `UPDATE videos
          SET status = 'MODERATION', provider_id = $2, hls_url = $3, thumbnail_url = $4,
              duration_ms = COALESCE($5, duration_ms)
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING *`,
      [videoId, providerId, ready.hlsUrl, ready.thumbnailUrl, ready.durationMs],
    );
    const v = moved.rows[0];
    if (!v) return; // duplicate webhook or already handled

    const verdict = await this.moderator.scan({
      id: v.id, authorId: v.author_id, hlsUrl: ready.hlsUrl, thumbnailUrl: ready.thumbnailUrl,
    });
    if (verdict === 'PASS') {
      await this.pg.query(`UPDATE videos SET status = 'PUBLISHED', published_at = now() WHERE id = $1 AND status = 'MODERATION'`, [videoId]);
    } else if (verdict === 'REJECT') {
      await this.pg.query(`UPDATE videos SET status = 'REJECTED', failure_reason = 'policy' WHERE id = $1 AND status = 'MODERATION'`, [videoId]);
    } // REVIEW: stays in MODERATION until a human acts (admin portal, M5)
  }

  private async markFailed(videoId: string, reason: string, from: string[]): Promise<void> {
    await this.pg.query(
      `UPDATE videos SET status = 'FAILED', failure_reason = $2 WHERE id = $1 AND status::text = ANY($3::text[])`,
      [videoId, reason, from],
    );
  }

  // ---------- Reads ----------

  async get(userId: string, videoId: string) {
    const { rows } = await this.pg.query<VideoRow>(`SELECT * FROM videos WHERE id = $1`, [videoId]);
    const v = rows[0];
    if (!v) throw new NotFoundException({ code: 'video_not_found' });
    if (v.author_id !== userId && v.status !== 'PUBLISHED') throw new NotFoundException({ code: 'video_not_found' });
    return this.toApi(v);
  }

  private async owned(userId: string, videoId: string): Promise<VideoRow> {
    const { rows } = await this.pg.query<VideoRow>(`SELECT * FROM videos WHERE id = $1`, [videoId]);
    const v = rows[0];
    if (!v) throw new NotFoundException({ code: 'video_not_found' });
    if (v.author_id !== userId) throw new ForbiddenException({ code: 'not_owner' });
    return v;
  }

  private toApi(v: VideoRow) {
    return {
      id: v.id,
      status: v.status,
      caption: v.caption,
      hlsUrl: v.hls_url,
      thumbnailUrl: v.thumbnail_url,
      durationMs: v.duration_ms,
      failureReason: v.failure_reason,
      createdAt: v.created_at.toISOString(),
      publishedAt: v.published_at?.toISOString() ?? null,
    };
  }
}
