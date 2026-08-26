import type { Redis } from 'ioredis';

export type QuotaResult = { allowed: boolean; used: number; limit: number; resetSeconds: number };

/**
 * A fixed-window per-key quota. The window key includes the hour so counters
 * expire on their own and no sweeper process is needed.
 */
export async function consumeQuota(redis: Redis, scope: string, key: string, limit: number, windowSeconds = 3_600): Promise<QuotaResult> {
  const window = Math.floor(Date.now() / 1_000 / windowSeconds);
  const redisKey = `map-studio:quota:${scope}:${hashKey(key)}:${window}`;
  const used = await redis.incr(redisKey);
  if (used === 1) await redis.expire(redisKey, windowSeconds);
  const ttl = await redis.ttl(redisKey);
  return { allowed: used <= limit, used, limit, resetSeconds: ttl > 0 ? ttl : windowSeconds };
}

/** Keys are secrets, so only a short non-reversible digest reaches Redis. */
function hashKey(key: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
