-- Minimal schema needed for M1 (auth) and M2 (upload -> playback).
-- The full data model (follows, likes, comments, hashtags, sounds...) comes in the database phase.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text UNIQUE,
  username     citext UNIQUE,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TYPE video_status AS ENUM ('UPLOADING','PROCESSING','MODERATION','PUBLISHED','REJECTED','FAILED');

CREATE TABLE videos (
  id             uuid PRIMARY KEY,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         video_status NOT NULL DEFAULT 'UPLOADING',
  caption        text NOT NULL DEFAULT '',
  source_key     text NOT NULL,
  upload_id      text NOT NULL,
  size_bytes     bigint NOT NULL,
  duration_ms    integer,
  provider_id    text,
  hls_url        text,
  thumbnail_url  text,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX videos_author_idx ON videos (author_id, created_at DESC);
CREATE INDEX videos_feed_idx ON videos (published_at DESC, id DESC) WHERE status = 'PUBLISHED';
