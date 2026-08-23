import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { PlatformConfig } from './config.js';
import type { BatchStatus, ShardJobData } from './contracts.js';

export function createRedis(config: PlatformConfig) {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createRenderQueue(config: PlatformConfig, connection: Redis) {
  return new Queue<ShardJobData>(config.QUEUE_NAME, { connection });
}

export const statusKey = (batchId: string) => `map-studio:batch:${batchId}`;
export const idempotencyKey = (key: string) => `map-studio:idempotency:${key}`;

export async function writeStatus(redis: Redis, config: PlatformConfig, status: BatchStatus) {
  await redis.hset(statusKey(status.batchId), Object.fromEntries(Object.entries(status).map(([key, value]) => [key, String(value)])));
  await redis.expire(statusKey(status.batchId), config.STATUS_TTL_SECONDS);
}

export async function readStatus(redis: Redis, batchId: string): Promise<BatchStatus | null> {
  const value = await redis.hgetall(statusKey(batchId));
  if (!value.batchId) return null;
  return {
    batchId: value.batchId,
    status: value.status as BatchStatus['status'],
    totalShards: Number(value.totalShards),
    completedShards: Number(value.completedShards),
    failedShards: Number(value.failedShards),
    completedOutputs: Number(value.completedOutputs),
    failedOutputs: Number(value.failedOutputs),
    expectedRecords: Number(value.expectedRecords),
    createdAt: value.createdAt ?? '',
    updatedAt: value.updatedAt ?? '',
  };
}

export async function incrementStatus(redis: Redis, batchId: string, field: 'completedShards' | 'failedShards' | 'completedOutputs' | 'failedOutputs', amount = 1) {
  await redis.hincrby(statusKey(batchId), field, amount);
  await redis.hset(statusKey(batchId), 'updatedAt', new Date().toISOString());
}
