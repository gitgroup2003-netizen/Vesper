import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG } from '../infra/infra.module';

interface FeedRow {
  id: string; caption: string; hls_url: string; thumbnail_url: string | null; duration_ms: number | null;
  published_at_iso: string; author_id: string; username: string | null; display_name: string | null;
}

/**
 * M2 placeholder ranker: reverse-chronological published videos with a keyset cursor.
 * The cursor carries the timestamp as a microsecond-precision string (JS Date would truncate to ms
 * and cause skipped/duplicated rows). M4 replaces this with candidate generation + ranking behind the same endpoint.
 */
@Injectable()
export class FeedService {
  constructor(@Inject(PG) private readonly pg: Pool) {}

  async forYou(cursor: string | undefined, limit: number) {
    let ts: string | null = null;
    let id: string | null = null;
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
      if (decoded.length !== 2 || !/^[0-9a-f-]{36}$/.test(decoded[1])) throw new BadRequestException({ code: 'bad_cursor' });
      [ts, id] = decoded;
    }
    const { rows } = await this.pg.query<FeedRow>(
      `SELECT v.id, v.caption, v.hls_url, v.thumbnail_url, v.duration_ms,
              to_char(v.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at_iso,
              u.id AS author_id, u.username, u.display_name
         FROM videos v JOIN users u ON u.id = v.author_id
        WHERE v.status = 'PUBLISHED'
          AND ($1::timestamptz IS NULL OR (v.published_at, v.id) < ($1::timestamptz, $2::uuid))
        ORDER BY v.published_at DESC, v.id DESC
        LIMIT $3`,
      [ts, id, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        caption: r.caption,
        hlsUrl: r.hls_url,
        thumbnailUrl: r.thumbnail_url,
        durationMs: r.duration_ms,
        publishedAt: r.published_at_iso,
        author: { id: r.author_id, username: r.username, displayName: r.display_name },
      })),
      nextCursor: rows.length > limit && last ? Buffer.from(`${last.published_at_iso}|${last.id}`).toString('base64url') : null,
    };
  }
}
