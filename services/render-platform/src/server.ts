import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { loadConfig } from './config.js';
import { BatchRenderRequestSchema, type BatchStatus } from './contracts.js';
import { createRedis, createRenderQueue, idempotencyKey, readStatus, statusKey, writeStatus } from './queue.js';

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] }, bodyLimit: 1_048_576, requestTimeout: 30_000 });
  const redis = createRedis(config);
  const queue = createRenderQueue(config, redis);
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'map_studio_' });
  const submitted = new Counter({ name: 'map_studio_batches_submitted_total', help: 'Accepted batch-render jobs', registers: [registry] });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/ready' || request.url === '/metrics') return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token || !config.apiKeys.has(token)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/health', async () => ({ ok: true, service: 'map-studio-production-api' }));
  app.get('/ready', async (_request, reply) => {
    try { await redis.ping(); return { ok: true }; }
    catch { return reply.code(503).send({ ok: false }); }
  });
  app.get('/metrics', async (_request, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  app.post('/v1/render-jobs', async (request, reply) => {
    const parsed = BatchRenderRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const batch = parsed.data;
    if (batch.manifest.shardCount > config.MAX_SHARDS_PER_BATCH) return reply.code(413).send({ error: 'too_many_shards', maximum: config.MAX_SHARDS_PER_BATCH });
    const existing = await redis.get(idempotencyKey(batch.idempotencyKey));
    if (existing) {
      const status = await readStatus(redis, existing);
      return reply.code(200).send(status ?? { batchId: existing, status: 'queued' });
    }

    const batchId = nanoid(20);
    const now = new Date().toISOString();
    const status: BatchStatus = { batchId, status: 'queued', totalShards: batch.manifest.shardCount, completedShards: 0, failedShards: 0, completedOutputs: 0, failedOutputs: 0, expectedRecords: batch.manifest.expectedRecords, createdAt: now, updatedAt: now };
    await writeStatus(redis, config, status);
    const claimed = await redis.set(idempotencyKey(batch.idempotencyKey), batchId, 'EX', config.STATUS_TTL_SECONDS, 'NX');
    if (!claimed) {
      const raced = await redis.get(idempotencyKey(batch.idempotencyKey));
      await redis.del(statusKey(batchId));
      return reply.code(200).send(raced ? await readStatus(redis, raced) : status);
    }
    await queue.addBulk(Array.from({ length: batch.manifest.shardCount }, (_, shardIndex) => ({
      name: 'render-shard',
      data: { batchId, shardIndex, request: batch },
      opts: { jobId: `${batchId}:${shardIndex}`, attempts: 4, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: { age: 86_400, count: 5_000 }, removeOnFail: { age: 604_800, count: 10_000 } },
    })));
    submitted.inc();
    return reply.code(202).send(status);
  });

  app.get<{ Params: { batchId: string } }>('/v1/render-jobs/:batchId', async (request, reply) => {
    const status = await readStatus(redis, request.params.batchId);
    return status ? status : reply.code(404).send({ error: 'not_found' });
  });

  app.delete<{ Params: { batchId: string } }>('/v1/render-jobs/:batchId', async (request, reply) => {
    const status = await readStatus(redis, request.params.batchId);
    if (!status) return reply.code(404).send({ error: 'not_found' });
    if (status.status === 'complete') return reply.code(409).send({ error: 'already_complete' });
    await redis.hset(statusKey(status.batchId), { status: 'canceled', updatedAt: new Date().toISOString() });
    return reply.code(202).send({ ...status, status: 'canceled' });
  });

  app.addHook('onClose', async () => { await queue.close(); await redis.quit(); });
  return { app, config };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, config } = await buildServer();
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ host: config.HOST, port: config.PORT });
}
