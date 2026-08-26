import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PlatformConfig } from './config.js';
import type { VideoJobData, VideoJobStatus } from './video-contracts.js';

export const videoStatusKey = (jobId: string) => `map-studio:video:${jobId}`;
export const videoCancelKey = (jobId: string) => `map-studio:video:${jobId}:cancel`;
export const VIDEO_DEAD_LETTER_QUEUE = 'map-studio-video-dead-letter';

export function createVideoQueue(config: PlatformConfig, connection: Redis) {
  return new Queue<VideoJobData>(config.VIDEO_QUEUE_NAME, { connection });
}

export function createVideoDeadLetterQueue(connection: Redis) {
  return new Queue(VIDEO_DEAD_LETTER_QUEUE, { connection });
}

export async function writeVideoStatus(redis: Redis, config: PlatformConfig, status: VideoJobStatus) {
  const entries = Object.entries(status).filter(([, value]) => value !== undefined);
  await redis.hset(videoStatusKey(status.jobId), Object.fromEntries(entries.map(([key, value]) => [key, String(value)])));
  await redis.expire(videoStatusKey(status.jobId), config.STATUS_TTL_SECONDS);
}

export async function patchVideoStatus(redis: Redis, jobId: string, patch: Partial<VideoJobStatus>) {
  const entries = Object.entries({ ...patch, updatedAt: new Date().toISOString() }).filter(([, value]) => value !== undefined);
  await redis.hset(videoStatusKey(jobId), Object.fromEntries(entries.map(([key, value]) => [key, String(value)])));
}

export async function readVideoStatus(redis: Redis, jobId: string): Promise<VideoJobStatus | null> {
  const value = await redis.hgetall(videoStatusKey(jobId));
  if (!value.jobId) return null;
  return {
    jobId: value.jobId,
    status: value.status as VideoJobStatus['status'],
    framesRendered: Number(value.framesRendered ?? 0),
    totalFrames: Number(value.totalFrames ?? 0),
    format: value.format ?? 'mp4',
    createdAt: value.createdAt ?? '',
    updatedAt: value.updatedAt ?? '',
    outputUri: value.outputUri || undefined,
    // The storage key is what the API needs to mint a fresh download URL.
    outputKey: value.outputKey || undefined,
    downloadUrl: value.downloadUrl || undefined,
    error: value.error || undefined,
    attempts: Number(value.attempts ?? 0),
  };
}

export async function isVideoCanceled(redis: Redis, jobId: string) {
  return (await redis.exists(videoCancelKey(jobId))) === 1;
}

