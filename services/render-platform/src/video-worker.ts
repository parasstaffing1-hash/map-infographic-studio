import { Worker, type Job } from 'bullmq';
import { chromium, type Browser } from 'playwright-core';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { Redis } from 'ioredis';
import { loadConfig, type PlatformConfig } from './config.js';
import { createRedis } from './queue.js';
import { createObjectStore } from './storage.js';
import { contentTypeFor, encodeFrames, probeFfmpeg } from './ffmpeg.js';
import { VIDEO_DIMENSIONS, videoFrameCount, type VideoJobData } from './video-contracts.js';
import { captureFrames } from './video-renderer.js';
import { createVideoDeadLetterQueue, isVideoCanceled, patchVideoStatus } from './video-queue.js';

function outputKey(prefix: string, jobId: string, extension: string) {
  const normalized = prefix.replace(/^\/+|\/+$/g, '');
  return [normalized, `${jobId}.${extension}`].filter(Boolean).join('/');
}

export async function processVideoJob(
  job: Job<VideoJobData>,
  dependencies: { redis: Redis; config: PlatformConfig; browser: () => Promise<Browser>; store: ReturnType<typeof createObjectStore> },
) {
  const { redis, config, store } = dependencies;
  const { jobId, request } = job.data;
  if (await isVideoCanceled(redis, jobId)) {
    await patchVideoStatus(redis, jobId, { status: 'canceled' });
    return;
  }

  const controller = new AbortController();
  const total = videoFrameCount(request.spec);
  await patchVideoStatus(redis, jobId, { status: 'rendering', totalFrames: total, framesRendered: 0, attempts: job.attemptsMade + 1 });

  // Cancellation is polled because the flag is set by a different process.
  const cancelPoll = setInterval(() => {
    void isVideoCanceled(redis, jobId).then((canceled) => canceled && controller.abort());
  }, 2_000);

  try {
    const browser = await dependencies.browser();
    const frames = await captureFrames(browser, config, request, async (rendered) => {
      await patchVideoStatus(redis, jobId, { framesRendered: rendered });
      await job.updateProgress(Math.round((rendered / total) * 90));
    }, controller.signal);

    const { width, height } = VIDEO_DIMENSIONS[request.spec.preset];
    await patchVideoStatus(redis, jobId, { status: 'encoding' });
    const audioTrack = request.spec.audioTrack;
    const encoded = await encodeFrames(frames, {
      format: request.spec.format,
      fps: request.spec.fps,
      width,
      height,
      loop: request.spec.loop,
      ffmpegPath: config.FFMPEG_PATH,
      timeoutMs: config.VIDEO_ENCODE_TIMEOUT_MS,
      signal: controller.signal,
      audio: audioTrack && audioTrack.source !== 'none' ? {
        audioData: audioTrack.audioData,
        volume: audioTrack.volume,
        fadeInSeconds: audioTrack.fadeInSeconds,
        fadeOutSeconds: audioTrack.fadeOutSeconds,
        durationSeconds: request.spec.durationSeconds,
      } : undefined,
    });

    const key = outputKey(request.outputPrefix, jobId, request.spec.format);
    const uri = await store.put(key, encoded, contentTypeFor(request.spec.format));
    // Only the storage key is recorded. The API mints a short-lived download URL
    // when the status is read, so a link can never outlive its expiry and the
    // bucket is never addressed directly by the browser.
    await patchVideoStatus(redis, jobId, {
      status: 'complete',
      framesRendered: total,
      outputUri: uri,
      outputKey: key,
    });
    await job.updateProgress(100);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      await patchVideoStatus(redis, jobId, { status: 'canceled', error: 'Canceled by request' });
      return;
    }
    await patchVideoStatus(redis, jobId, { status: 'failed', error: message.slice(0, 400) });
    throw error;
  } finally {
    clearInterval(cancelPoll);
  }
}

export async function startVideoWorker() {
  const config = loadConfig();
  const redis = createRedis(config);
  const store = createObjectStore(config);
  const deadLetter = createVideoDeadLetterQueue(redis);
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'map_studio_video_' });
  const completed = new Counter({ name: 'map_studio_video_jobs_total', help: 'Video jobs by outcome', labelNames: ['outcome', 'format'], registers: [registry] });
  const duration = new Histogram({ name: 'map_studio_video_duration_seconds', help: 'End-to-end video job duration', buckets: [5, 15, 30, 60, 120, 300, 600], registers: [registry] });
  const active = new Gauge({ name: 'map_studio_video_active_jobs', help: 'Video jobs currently being processed', registers: [registry] });

  const probe = await probeFfmpeg(config.FFMPEG_PATH);
  if (!probe.available) {
    // Fail fast and loudly: a worker without FFmpeg can never complete a job.
    throw new Error(`FFmpeg is not usable at ${config.FFMPEG_PATH}: ${probe.error ?? 'unknown error'}`);
  }

  let browser: Browser | undefined;
  const getBrowser = async () => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({ headless: true, executablePath: config.CHROMIUM_EXECUTABLE_PATH, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    }
    return browser;
  };

  const worker = new Worker<VideoJobData>(
    config.VIDEO_QUEUE_NAME,
    async (job) => {
      active.inc();
      const stop = duration.startTimer();
      try {
        await processVideoJob(job, { redis, config, browser: getBrowser, store });
        completed.inc({ outcome: 'success', format: job.data.request.spec.format });
      } catch (error) {
        completed.inc({ outcome: 'failure', format: job.data.request.spec.format });
        throw error;
      } finally {
        stop();
        active.dec();
      }
    },
    {
      connection: redis,
      concurrency: config.VIDEO_WORKER_CONCURRENCY,
      lockDuration: Math.max(config.VIDEO_ENCODE_TIMEOUT_MS * 2, 300_000),
    },
  );

  worker.on('failed', async (job, error) => {
    if (!job) return;
    const attemptsAllowed = job.opts.attempts ?? 1;
    if (job.attemptsMade < attemptsAllowed) return;
    // Exhausted every retry: park the job so it can be inspected and replayed.
    await deadLetter.add('dead-video-job', { jobId: job.data.jobId, request: job.data.request, error: error.message, failedAt: new Date().toISOString() }, { removeOnComplete: false });
    await patchVideoStatus(redis, job.data.jobId, { status: 'failed', error: `Moved to dead-letter queue: ${error.message.slice(0, 300)}` });
  });

  const shutdown = async () => {
    await worker.close();
    if (browser) await browser.close().catch(() => undefined);
    await deadLetter.close();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { worker, redis, registry, ffmpeg: probe };
}

if (process.env.NODE_ENV !== 'test') await startVideoWorker();
