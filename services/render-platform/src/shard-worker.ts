import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { loadConfig, type PlatformConfig } from './config.js';
import type { ManifestRecord, RenderTask, ShardJobData } from './contracts.js';
import { manifestUrl, readManifest } from './ndjson.js';
import { createRedis, incrementStatus, readStatus, statusKey } from './queue.js';

function assertAllowedManifest(urlValue: string, config: PlatformConfig) {
  const url = new URL(urlValue);
  if (!config.manifestAllowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Manifest host ${url.hostname} is not in MANIFEST_ALLOWED_HOSTS`);
  }
  return url.toString();
}

async function renderRecord(task: RenderTask, config: PlatformConfig) {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${config.RENDERER_URL}/v1/render`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.INTERNAL_RENDER_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(task),
        signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Renderer returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error('Renderer failed');
}

async function recordOutcome(redis: Redis, batchId: string, record: ManifestRecord, outcome: 'complete' | 'failed') {
  const dedupeKey = `map-studio:batch:${batchId}:outputs:${outcome}`;
  if (await redis.sadd(dedupeKey, record.id)) {
    await incrementStatus(redis, batchId, outcome === 'complete' ? 'completedOutputs' : 'failedOutputs');
  }
}

async function finalizeBatch(redis: Redis, batchId: string) {
  const status = await readStatus(redis, batchId);
  if (!status || status.status === 'canceled') return;
  if (status.completedShards + status.failedShards < status.totalShards) return;
  const nextStatus = status.completedOutputs === 0 && status.failedOutputs > 0
    ? 'failed'
    : status.failedShards > 0 || status.failedOutputs > 0 ? 'partial' : 'complete';
  await redis.hset(statusKey(batchId), { status: nextStatus, updatedAt: new Date().toISOString() });
}

async function markShard(redis: Redis, batchId: string, shardIndex: number, failed: boolean) {
  const dedupeKey = `map-studio:batch:${batchId}:finished-shards`;
  if (await redis.sadd(dedupeKey, String(shardIndex))) {
    await incrementStatus(redis, batchId, failed ? 'failedShards' : 'completedShards');
  }
  await finalizeBatch(redis, batchId);
}

async function processShard(job: Job<ShardJobData>, redis: Redis, config: PlatformConfig) {
  const { batchId, shardIndex, request } = job.data;
  const initialStatus = await readStatus(redis, batchId);
  if (!initialStatus || initialStatus.status === 'canceled') return;
  await redis.hset(statusKey(batchId), { status: 'running', updatedAt: new Date().toISOString() });

  const url = assertAllowedManifest(manifestUrl(request.manifest.urlTemplate, shardIndex), config);
  const response = await fetch(url, { signal: AbortSignal.timeout(config.RENDER_TIMEOUT_MS) });
  const inFlight = new Set<Promise<void>>();
  let failedRecords = 0;
  let seen = 0;

  for await (const record of readManifest(response, config.MAX_RECORDS_PER_SHARD)) {
    seen += 1;
    const promise = (async () => {
      const status = await readStatus(redis, batchId);
      if (!status || status.status === 'canceled') return;
      const task: RenderTask = { batchId, templateId: request.templateId, record, viewMode: record.viewMode ?? request.viewMode, output: request.output };
      try {
        await renderRecord(task, config);
        await recordOutcome(redis, batchId, record, 'complete');
      } catch (error) {
        failedRecords += 1;
        await recordOutcome(redis, batchId, record, 'failed');
        job.log(`Record ${record.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    if (inFlight.size >= config.RECORD_CONCURRENCY) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  await job.updateProgress({ seen, failedRecords });
  await markShard(redis, batchId, shardIndex, failedRecords > 0);
}

export async function startShardWorker() {
  const config = loadConfig();
  const redis = createRedis(config);
  const worker = new Worker<ShardJobData>(config.QUEUE_NAME, (job) => processShard(job, redis, config), {
    connection: redis,
    concurrency: config.WORKER_CONCURRENCY,
    lockDuration: Math.max(config.RENDER_TIMEOUT_MS * 4, 120_000),
  });

  worker.on('failed', async (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    job.log(`Shard failed permanently: ${error.message}`);
    await markShard(redis, job.data.batchId, job.data.shardIndex, true);
  });

  const shutdown = async () => { await worker.close(); await redis.quit(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return { worker, redis };
}

if (process.env.NODE_ENV !== 'test') await startShardWorker();
