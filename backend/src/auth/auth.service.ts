import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG, REDIS } from '../infra/infra.module';
import { SMS_SENDER, SmsSender } from './sms';
import { config } from '../config';

const OTP_TTL_S = 300;
const OTP_MAX_ATTEMPTS = 5;
const ACCESS_TTL_S = 900;

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }
export interface AuthResult extends TokenPair {
  user: { id: string; username: string | null; displayName: string | null };
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG) private readonly pg: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly jwt: JwtService,
  ) {}

  private hashOtp(phone: string, code: string): string {
    return createHmac('sha256', config.otpSecret).update(`${phone}:${code}`).digest('hex');
  }

  private async limit(key: string, max: number, windowSec: number): Promise<void> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, windowSec);
    if (n > max) throw new HttpException({ code: 'rate_limited' }, 429);
  }

  async requestOtp(phone: string, ip: string): Promise<void> {
    await this.limit(`rl:otp:phone:${phone}`, 5, 3600);
    await this.limit(`rl:otp:ip:${ip}`, 20, 3600);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .set(`otp:${phone}`, this.hashOtp(phone, code), 'EX', OTP_TTL_S)
      .del(`otp:att:${phone}`)
      .exec();
    await this.sms.send(phone, `Your Vesper code is ${code}. It expires in 5 minutes.`);
  }

  async verifyOtp(phone: string, code: string): Promise<AuthResult> {
    const attempts = await this.redis.incr(`otp:att:${phone}`);
    if (attempts === 1) await this.redis.expire(`otp:att:${phone}`, OTP_TTL_S);
    if (attempts > OTP_MAX_ATTEMPTS) throw new HttpException({ code: 'too_many_attempts' }, 429);

    const stored = await this.redis.get(`otp:${phone}`);
    if (!stored) throw new UnauthorizedException({ code: 'invalid_code' });
    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(this.hashOtp(phone, code), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException({ code: 'invalid_code' });
    await this.redis.del(`otp:${phone}`, `otp:att:${phone}`);

    const { rows } = await this.pg.query<{ id: string; username: string | null; display_name: string | null; created: boolean }>(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, username, display_name, (xmax = 0) AS created`,
      [phone],
    );
    const u = rows[0];
    const tokens = await this.issueTokens(u.id);
    return { ...tokens, user: { id: u.id, username: u.username, displayName: u.display_name }, isNewUser: u.created };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.hashToken(refreshToken);
    const { rows } = await this.pg.query<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expired: boolean }>(
      `SELECT id, user_id, family_id, revoked_at, (expires_at < now()) AS expired FROM refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException({ code: 'invalid_refresh_token' });
    if (row.revoked_at) {
      // Reuse of a rotated token: assume theft and kill the whole family.
      await this.pg.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
      throw new UnauthorizedException({ code: 'refresh_token_reused' });
    }
    if (row.expired) throw new UnauthorizedException({ code: 'refresh_token_expired' });

    const rotated = await this.pg.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
      [row.id],
    );
    if (!rotated.rowCount) throw new UnauthorizedException({ code: 'refresh_token_reused' });
    return this.issueTokens(row.user_id, row.family_id);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(userId: string, familyId: string = randomUUID()): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId }, { expiresIn: ACCESS_TTL_S });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.pg.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '60 days')`,
      [userId, familyId, this.hashToken(refreshToken)],
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_S };
  }
}
