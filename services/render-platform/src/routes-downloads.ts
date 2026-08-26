import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { PlatformConfig } from './config.js';
import { contentTypeForKey, type ObjectStore } from './storage.js';
import { readVideoStatus } from './video-queue.js';

/**
 * Mints the URL a browser should use to fetch a finished render.
 *
 * S3-compatible storage gets a time-limited presigned URL signed against the
 * public endpoint. Local-disk storage cannot be presigned, so the caller is
 * pointed at the authenticated streaming endpoint instead. Either way the
 * bucket itself is never exposed and no internal container hostname escapes.
 */
export async function downloadUrlFor(
  store: ObjectStore,
  config: PlatformConfig,
  key: string,
): Promise<{ url: string; expiresInSeconds: number; mode: 'presigned' | 'stream' }> {
  const ttl = config.DOWNLOAD_URL_TTL_SECONDS;
  const presigned = await store.presign(key, ttl).catch(() => null);
  if (presigned) return { url: presigned, expiresInSeconds: ttl, mode: 'presigned' };
  return {
    url: `${config.APP_API_PUBLIC_URL.replace(/\/$/, '')}/v1/video-jobs/${encodeURIComponent(jobIdFromKey(key))}/download`,
    expiresInSeconds: ttl,
    mode: 'stream',
  };
}

/** Keys are written as `<prefix>/<jobId>.<ext>`, so the job id is recoverable. */
export function jobIdFromKey(key: string) {
  const file = key.split('/').pop() ?? key;
  return file.replace(/\.[a-z0-9]+$/i, '');
}

export function registerDownloadRoutes(app: FastifyInstance, dependencies: { redis: Redis; config: PlatformConfig; store: ObjectStore }) {
  const { redis, config, store } = dependencies;

  // Streaming fallback. This route sits behind the same API-key hook as the rest
  // of /v1/video-jobs, so an unauthenticated caller cannot pull a render.
  app.get<{ Params: { jobId: string } }>('/v1/video-jobs/:jobId/download', async (request, reply) => {
    const status = await readVideoStatus(redis, request.params.jobId);
    if (!status || status.status !== 'complete' || !status.outputKey) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const object = await store.get(status.outputKey);
      reply.header('content-type', object.contentType || contentTypeForKey(status.outputKey));
      reply.header('content-disposition', `attachment; filename="${jobIdFromKey(status.outputKey)}.${status.format}"`);
      if (object.contentLength !== undefined) reply.header('content-length', String(object.contentLength));
      reply.header('cache-control', 'private, no-store');
      return reply.send(object.body);
    } catch (error) {
      request.log.error({ err: error, key: status.outputKey }, 'download failed');
      return reply.code(404).send({ error: 'not_found' });
    }
  });
}
