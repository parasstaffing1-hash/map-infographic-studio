import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  RENDERER_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_NAME: z.string().default('map-studio-render-shards'),
  API_KEYS: z.string().min(12).default('local-development-key'),
  INTERNAL_RENDER_TOKEN: z.string().min(12).default('local-renderer-token'),
  CORS_ORIGINS: z.string().default('http://127.0.0.1:4173,http://127.0.0.1:4174'),
  MAX_SHARDS_PER_BATCH: z.coerce.number().int().min(1).max(100_000).default(10_000),
  STATUS_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(8),
  RECORD_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  MAX_RECORDS_PER_SHARD: z.coerce.number().int().min(1).max(100_000).default(5_000),
  MANIFEST_ALLOWED_HOSTS: z.string().default('127.0.0.1,localhost'),
  RENDERER_URL: z.string().url().default('http://127.0.0.1:8788'),
  WEB_APP_URL: z.string().url().default('http://127.0.0.1:4174'),
  RENDER_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(45_000),
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  OUTPUT_DIRECTORY: z.string().default('./outputs'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // The endpoint a BROWSER can reach. Inside Docker S3_ENDPOINT is an internal
  // hostname (http://minio:9000) that no browser resolves, so presigned URLs are
  // signed against this one instead. Leave unset when they are the same host.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  // Explicit credentials win; when unset the AWS default provider chain is used
  // (environment, shared config, instance role), which is what Docker relies on.
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Cloudflare R2 is S3-compatible. These aliases keep production secrets
  // provider-specific while the rest of the application stays S3-neutral.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_PUBLIC_ENDPOINT: z.string().url().optional(),
  R2_REGION: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  // The API origin a browser can reach, used to build streaming download links.
  APP_API_PUBLIC_URL: z.string().url().default('http://127.0.0.1:8787'),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(604_800).default(900),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  // Video rendering
  VIDEO_QUEUE_NAME: z.string().default('map-studio-video-jobs'),
  VIDEO_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  VIDEO_ENCODE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(1_800_000).default(600_000),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  PUBLIC_DOWNLOAD_BASE_URL: z.string().default('http://127.0.0.1:8787/downloads'),
  VIDEO_JOBS_PER_KEY_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(60),
  BATCH_JOBS_PER_KEY_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(120),

  // Application tier: accounts, workspaces and projects.
  // Optional on purpose — with no DATABASE_URL the render/video API still boots
  // and the application routes answer 503 instead of the process crashing.
  DATABASE_URL: z.string().min(1).optional(),
  AIVEN_DATABASE_URL: z.string().min(1).optional(),
  AIVEN_POSTGRES_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  DATABASE_SSL_CA: z.string().optional(),
  DATABASE_SSL_CA_FILE: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(720),
  APP_BASE_URL: z.string().url().default('http://127.0.0.1:4174'),
});

export type PlatformConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvironmentSchema.parse(environment);
  const r2Configured = Boolean(parsed.R2_BUCKET || parsed.R2_ENDPOINT || parsed.R2_ACCOUNT_ID || parsed.R2_ACCESS_KEY_ID || parsed.R2_SECRET_ACCESS_KEY);
  const r2Endpoint = parsed.R2_ENDPOINT ?? (parsed.R2_ACCOUNT_ID ? `https://${parsed.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const databaseUrl = parsed.DATABASE_URL ?? parsed.AIVEN_DATABASE_URL ?? parsed.AIVEN_POSTGRES_URL;
  return {
    ...parsed,
    // Explicit S3_* values always win. R2_* values are aliases for deployments
    // that use Cloudflare's terminology, with the documented R2 defaults.
    S3_BUCKET: parsed.S3_BUCKET ?? parsed.R2_BUCKET,
    S3_REGION: parsed.S3_REGION ?? (r2Configured ? parsed.R2_REGION ?? 'auto' : 'us-east-1'),
    S3_ENDPOINT: parsed.S3_ENDPOINT ?? r2Endpoint,
    S3_PUBLIC_ENDPOINT: parsed.S3_PUBLIC_ENDPOINT ?? parsed.R2_PUBLIC_ENDPOINT,
    S3_ACCESS_KEY_ID: parsed.S3_ACCESS_KEY_ID ?? parsed.R2_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: parsed.S3_SECRET_ACCESS_KEY ?? parsed.R2_SECRET_ACCESS_KEY,
    DATABASE_URL: databaseUrl,
    apiKeys: new Set(parsed.API_KEYS.split(',').map((key) => key.trim()).filter(Boolean)),
    corsOrigins: parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    manifestAllowedHosts: new Set(parsed.MANIFEST_ALLOWED_HOSTS.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)),
  };
}
