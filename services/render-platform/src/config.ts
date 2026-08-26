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
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  // Video rendering
  VIDEO_QUEUE_NAME: z.string().default('map-studio-video-jobs'),
  VIDEO_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  VIDEO_ENCODE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(1_800_000).default(600_000),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  PUBLIC_DOWNLOAD_BASE_URL: z.string().default('http://127.0.0.1:8787/downloads'),
  VIDEO_JOBS_PER_KEY_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(60),
  BATCH_JOBS_PER_KEY_PER_HOUR: z.coerce.number().int().min(1).max(100_000).default(120),
});

export type PlatformConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    ...parsed,
    apiKeys: new Set(parsed.API_KEYS.split(',').map((key) => key.trim()).filter(Boolean)),
    corsOrigins: parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    manifestAllowedHosts: new Set(parsed.MANIFEST_ALLOWED_HOSTS.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)),
  };
}
