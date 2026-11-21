import { Injectable } from '@nestjs/common';

export type ModerationVerdict = 'PASS' | 'REJECT' | 'REVIEW';

export interface ModerationSubject {
  id: string;
  authorId: string;
  hlsUrl: string;
  thumbnailUrl: string | null;
}

/** Port for the pre-publish safety scan (NSFW / violence / audio fingerprint). Real adapters land in M5. */
export abstract class Moderator {
  abstract scan(subject: ModerationSubject): Promise<ModerationVerdict>;
}
export const MODERATOR = Symbol('MODERATOR');

/** MVP/dev adapter: approves everything. Replace before any public launch. */
@Injectable()
export class AutoApproveModerator extends Moderator {
  async scan(): Promise<ModerationVerdict> {
    return 'PASS';
  }
}
