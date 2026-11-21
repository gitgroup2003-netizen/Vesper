const req = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
};
const opt = (key: string, fallback: string): string => process.env[key] ?? fallback;

export const config = {
  port: Number(opt('PORT', '3000')),
  databaseUrl: req('DATABASE_URL'),
  redisUrl: req('REDIS_URL'),
  jwtSecret: req('JWT_SECRET'),
  otpSecret: req('OTP_SECRET'),
  s3: {
    endpoint: req('S3_ENDPOINT'),
    region: opt('S3_REGION', 'auto'),
    bucket: req('S3_BUCKET'),
    accessKeyId: req('S3_ACCESS_KEY_ID'),
    secretAccessKey: req('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: opt('S3_FORCE_PATH_STYLE', 'false') === 'true',
    publicBaseUrl: opt('S3_PUBLIC_BASE_URL', ''),
  },
  transcoder: opt('TRANSCODER', 'dev') as 'dev' | 'cloudflare',
  cf: {
    accountId: opt('CF_ACCOUNT_ID', ''),
    apiToken: opt('CF_STREAM_API_TOKEN', ''),
    webhookSecret: opt('CF_STREAM_WEBHOOK_SECRET', ''),
    customerCode: opt('CF_STREAM_CUSTOMER_CODE', ''),
  },
  upload: {
    partSizeBytes: 5 * 1024 * 1024,
    maxBytes: 300 * 1024 * 1024,
    maxPerDay: 30,
    urlTtlSeconds: 3600,
  },
} as const;
