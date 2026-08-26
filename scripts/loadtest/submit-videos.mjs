#!/usr/bin/env node
/**
 * submit-videos.mjs — end-to-end load test for POST /v1/video-jobs.
 *
 * Submits N video render jobs and polls GET /v1/video-jobs/:jobId until each one
 * reaches a terminal state (complete / failed / canceled), then reports:
 *   - submission outcomes (accepted, 429 quota rejections, errors)
 *   - queue wait  : submit -> first observed non-"queued" status
 *   - render time : first non-"queued" status -> terminal status
 *   - frames/sec  : totalFrames / render time (per job, from the status document)
 *   - end-to-end  : submit -> terminal, p50 / p95
 *
 * Timing caveat: statuses are sampled by polling, so queue-wait and render-time
 * carry up to one poll interval of error per boundary. Lower --poll-interval for
 * short jobs. This is a black-box client-side measurement, not worker
 * instrumentation.
 *
 * Zero dependencies: built-in fetch + node:util parseArgs only.
 */

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const HELP = `submit-videos.mjs — video job load test (POST /v1/video-jobs + polling)

Options:
  --api-url <url>       Render platform base URL (default: http://127.0.0.1:8787)
  --api-key <key>       Bearer token, must be in API_KEYS (default: $LOADTEST_API_KEY
                        or "local-development-key")
  --count <n>           Number of video jobs to submit (default: 5)
  --concurrency <n>     Concurrent in-flight submissions (default: 2)
  --duration <seconds>  spec.durationSeconds, 1-180 (default: 6)
  --fps <n>             spec.fps, 1-60 (default: 24)
  --preset <preset>     landscape-1080 | vertical-1080 | square-1080 | landscape-4k
                        (default: landscape-1080)
  --format <fmt>        mp4 | webm | gif (default: mp4)
  --mode <mode>         year-choropleth | bar-race | camera-tour | counter
                        (default: year-choropleth)
  --view-mode <mode>    viewMode for the job (default: india)
  --template-id <id>    templateId (default: loadtest-video)
  --rows <n>            Data rows in the synthetic project (default: 12)
  --timeout <ms>        Per-request timeout in ms (default: 30000)
  --poll-interval <ms>  Status poll interval (default: 2000)
  --poll-timeout <ms>   Give up on a job after this long (default: 600000)
  --no-poll             Submit only; skip polling
  --json                Emit the report as JSON instead of a text table
  -h, --help            Show this help

Notes:
  * The platform caps pixel budget at 3840*2160*1800 (MAX_PIXEL_BUDGET); an
    over-budget spec is rejected with HTTP 413 and counted, not retried.
  * 429 responses are counted and retry-after is honoured once when the wait is
    short; the hourly quota is VIDEO_JOBS_PER_KEY_PER_HOUR (default 60).
`;

const TERMINAL = new Set(['complete', 'failed', 'canceled']);
const PRESETS = ['landscape-1080', 'vertical-1080', 'square-1080', 'landscape-4k'];
const FORMATS = ['mp4', 'webm', 'gif'];
const MODES = ['year-choropleth', 'bar-race', 'camera-tour', 'counter'];
const PRESET_DIMENSIONS = {
  'landscape-1080': [1920, 1080],
  'vertical-1080': [1080, 1920],
  'square-1080': [1080, 1080],
  'landscape-4k': [3840, 2160],
};
const MAX_PIXEL_BUDGET = 3840 * 2160 * 1800;

const REGIONS = [
  'Andhra Pradesh', 'Bihar', 'Gujarat', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana',
  'Uttar Pradesh', 'West Bengal', 'Assam', 'Haryana',
];

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'api-url': { type: 'string', default: process.env.LOADTEST_API_URL ?? 'http://127.0.0.1:8787' },
      'api-key': { type: 'string', default: process.env.LOADTEST_API_KEY ?? 'local-development-key' },
      count: { type: 'string', default: '5' },
      concurrency: { type: 'string', default: '2' },
      duration: { type: 'string', default: '6' },
      fps: { type: 'string', default: '24' },
      preset: { type: 'string', default: 'landscape-1080' },
      format: { type: 'string', default: 'mp4' },
      mode: { type: 'string', default: 'year-choropleth' },
      'view-mode': { type: 'string', default: 'india' },
      'template-id': { type: 'string', default: 'loadtest-video' },
      rows: { type: 'string', default: '12' },
      timeout: { type: 'string', default: '30000' },
      'poll-interval': { type: 'string', default: '2000' },
      'poll-timeout': { type: 'string', default: '600000' },
      'no-poll': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  return values;
}

function positiveInt(raw, label, { min = 1 } = {}) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
  return sortedValues[index];
}

export function summarize(values, unit = 'Ms') {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const round = (value) => (value === null ? null : Number(value.toFixed(1)));
  return {
    samples: sorted.length,
    [`min${unit}`]: sorted.length ? round(sorted[0]) : null,
    [`p50${unit}`]: round(percentile(sorted, 0.5)),
    [`p95${unit}`]: round(percentile(sorted, 0.95)),
    [`p99${unit}`]: round(percentile(sorted, 0.99)),
    [`max${unit}`]: sorted.length ? round(sorted[sorted.length - 1]) : null,
  };
}

/** Mirrors videoFrameCount() in services/render-platform/src/video-contracts.ts. */
export function frameCount(durationSeconds, fps) {
  return Math.max(1, Math.round(durationSeconds * fps));
}

export function pixelBudget(preset, durationSeconds, fps) {
  const [width, height] = PRESET_DIMENSIONS[preset];
  return width * height * frameCount(durationSeconds, fps);
}

function buildProject(rowCount, seed) {
  const year = String(2019 + (seed % 6));
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const region = REGIONS[(seed + index) % REGIONS.length];
    const value = Number((((seed * 37 + index * 13) % 1000) / 10).toFixed(1));
    return {
      id: `row-${seed}-${index}`,
      region,
      value,
      year,
      raw: { region, value, year, source: 'loadtest-synthetic' },
    };
  });
  return {
    rows,
    config: { title: `Load test video ${seed}`, subtitle: 'Synthetic load-test data', palette: 'blues', valueColumn: 'value', regionColumn: 'region' },
    annotations: [],
    currentYear: year,
  };
}

export function buildVideoRequest(options, index) {
  return {
    idempotencyKey: `loadtest-video-${options.runId}-${index}`,
    templateId: options.templateId,
    viewMode: options.viewMode,
    compositionId: 'map-only',
    project: buildProject(options.rows, index + 1),
    spec: {
      mode: options.mode,
      preset: options.preset,
      format: options.format,
      durationSeconds: options.duration,
      fps: options.fps,
      introSeconds: 1,
      outroSeconds: 1,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      raceSize: 10,
      loop: false,
    },
    outputPrefix: 'loadtest-videos',
  };
}

function retryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function readBody(response) {
  try {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
  } catch {
    return null;
  }
}

async function submitOne(options, index, results) {
  const body = buildVideoRequest(options, index);
  let honouredRetryAfter = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = performance.now();
    let response;
    try {
      response = await fetch(`${options.apiUrl}/v1/video-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeout),
      });
    } catch (error) {
      results.errors.push({ index, kind: 'network', message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const elapsed = performance.now() - startedAt;
    results.submitLatencies.push(elapsed);

    if (response.status === 429) {
      const payload = await readBody(response);
      const waitMs = retryAfterMs(response);
      if (!honouredRetryAfter && waitMs !== null && waitMs > 0 && waitMs <= options.maxRetryAfterMs) {
        honouredRetryAfter = true;
        results.retriedAfter429 += 1;
        await sleep(waitMs);
        continue;
      }
      results.rejected429 += 1;
      const reason = payload?.error ?? 'rate_limited';
      results.rejectionReasons[reason] = (results.rejectionReasons[reason] ?? 0) + 1;
      return;
    }

    if (response.status === 413) {
      results.rejected413 += 1;
      return;
    }

    if (response.status === 202 || response.status === 200) {
      const payload = await readBody(response);
      results.accepted += 1;
      if (response.status === 200) results.idempotentReplays += 1;
      if (payload?.jobId) {
        const job = {
          jobId: payload.jobId,
          submittedAt: performance.now(),
          totalFrames: payload.totalFrames ?? frameCount(options.duration, options.fps),
        };
        results.jobs.push(job);
        // Start tracking immediately. Waiting until every submission finished
        // would charge later submissions' wall time to this job's queue wait.
        if (options.poll) {
          results.tracking.push(trackJob(options, job).catch((error) => ({
            jobId: job.jobId,
            status: 'poll_error',
            error: error instanceof Error ? error.message : String(error),
            queueWaitMs: null, renderMs: null, endToEndMs: null,
            totalFrames: job.totalFrames, framesRendered: 0, framesPerSecond: null, queueWaitObserved: false,
          })));
        }
      }
      return;
    }

    const payload = await readBody(response);
    results.byStatus[response.status] = (results.byStatus[response.status] ?? 0) + 1;
    results.errors.push({ index, kind: `http_${response.status}`, message: JSON.stringify(payload).slice(0, 300) });
    return;
  }
}

async function runSubmissions(options) {
  const results = {
    submitted: 0,
    accepted: 0,
    idempotentReplays: 0,
    rejected429: 0,
    rejected413: 0,
    retriedAfter429: 0,
    rejectionReasons: {},
    errors: [],
    byStatus: {},
    submitLatencies: [],
    jobs: [],
    tracking: [],
  };

  let nextIndex = 0;
  const startedAt = performance.now();
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      if (index >= options.count) return;
      nextIndex += 1;
      results.submitted += 1;
      await submitOne(options, index, results);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.count) }, worker));
  results.submitWallClockMs = performance.now() - startedAt;
  return results;
}

/**
 * Polls one job to a terminal state, recording the first observation where the
 * status left "queued" (the queue-wait boundary).
 */
async function trackJob(options, job) {
  const deadline = job.submittedAt + options.pollTimeout;
  let leftQueueAt = null;
  let lastStatus = 'queued';
  let framesRendered = 0;
  let totalFrames = job.totalFrames;

  while (performance.now() < deadline) {
    await sleep(options.pollInterval);
    let response;
    try {
      response = await fetch(`${options.apiUrl}/v1/video-jobs/${encodeURIComponent(job.jobId)}`, {
        headers: { authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(options.timeout),
      });
    } catch {
      continue; // Transient poll failure; try again on the next tick.
    }
    if (response.status === 429) {
      await sleep(Math.min(retryAfterMs(response) ?? options.pollInterval, options.pollInterval * 5));
      continue;
    }
    if (!response.ok) continue;

    const status = await readBody(response);
    if (!status || typeof status.status !== 'string') continue;
    lastStatus = status.status;
    if (Number.isFinite(status.framesRendered)) framesRendered = status.framesRendered;
    if (Number.isFinite(status.totalFrames) && status.totalFrames > 0) totalFrames = status.totalFrames;
    if (leftQueueAt === null && status.status !== 'queued') leftQueueAt = performance.now();

    if (TERMINAL.has(status.status)) {
      const finishedAt = performance.now();
      // If the job was never observed in a non-queued state it finished inside
      // one poll interval; attribute the whole span to render time.
      const startedRenderAt = leftQueueAt ?? job.submittedAt;
      const renderMs = finishedAt - startedRenderAt;
      return {
        jobId: job.jobId,
        status: status.status,
        error: status.error ?? null,
        queueWaitMs: startedRenderAt - job.submittedAt,
        renderMs,
        endToEndMs: finishedAt - job.submittedAt,
        totalFrames,
        framesRendered,
        framesPerSecond: renderMs > 0 ? (totalFrames / (renderMs / 1_000)) : null,
        queueWaitObserved: leftQueueAt !== null,
      };
    }
  }

  return {
    jobId: job.jobId,
    status: 'timeout',
    error: `did not reach a terminal state within ${options.pollTimeout} ms (last seen: ${lastStatus})`,
    queueWaitMs: null,
    renderMs: null,
    endToEndMs: null,
    totalFrames,
    framesRendered,
    framesPerSecond: null,
    queueWaitObserved: leftQueueAt !== null,
  };
}

function report(options, results, outcomes) {
  const submitSeconds = results.submitWallClockMs / 1_000;
  const completed = outcomes.filter((outcome) => outcome.status === 'complete');
  const byState = {};
  for (const outcome of outcomes) byState[outcome.status] = (byState[outcome.status] ?? 0) + 1;

  const payload = {
    target: `${options.apiUrl}/v1/video-jobs`,
    config: {
      count: options.count,
      concurrency: options.concurrency,
      preset: options.preset,
      format: options.format,
      mode: options.mode,
      durationSeconds: options.duration,
      fps: options.fps,
      framesPerJob: frameCount(options.duration, options.fps),
      pixelBudgetPerJob: pixelBudget(options.preset, options.duration, options.fps),
      maxPixelBudget: MAX_PIXEL_BUDGET,
    },
    submitted: results.submitted,
    accepted: results.accepted,
    idempotentReplays: results.idempotentReplays,
    rejectedByQuota429: results.rejected429,
    rejectedTooLarge413: results.rejected413,
    retriedAfterRetryAfter: results.retriedAfter429,
    rejectionReasons: results.rejectionReasons,
    errors: results.errors.length,
    errorSamples: results.errors.slice(0, 5),
    otherHttpStatuses: results.byStatus,
    submitWallClockSeconds: Number(submitSeconds.toFixed(3)),
    submissionThroughputPerSecond: submitSeconds > 0 ? Number((results.submitted / submitSeconds).toFixed(2)) : null,
    submissionLatency: summarize(results.submitLatencies),
    terminalStates: outcomes.length ? byState : null,
    queueWait: outcomes.length ? summarize(outcomes.map((outcome) => outcome.queueWaitMs)) : null,
    renderTime: outcomes.length ? summarize(outcomes.map((outcome) => outcome.renderMs)) : null,
    endToEnd: outcomes.length ? summarize(outcomes.map((outcome) => outcome.endToEndMs)) : null,
    framesPerSecond: completed.length ? summarize(completed.map((outcome) => outcome.framesPerSecond), 'Fps') : null,
    caveat: 'Timings are client-side and polled, so each boundary carries up to one poll interval of error.',
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  const fmt = (summary, key) => (summary && summary[key] !== null && summary[key] !== undefined ? summary[key] : 'n/a');
  const lines = [
    '',
    '=== video job load test ===',
    `target                 : ${payload.target}`,
    `count / concurrency    : ${options.count} / ${options.concurrency}`,
    `spec                   : ${options.preset} ${options.format} ${options.mode} ${options.duration}s @ ${options.fps}fps = ${payload.config.framesPerJob} frames`,
    `pixel budget per job   : ${payload.config.pixelBudgetPerJob.toLocaleString('en-US')} / ${MAX_PIXEL_BUDGET.toLocaleString('en-US')} allowed`,
    '',
    `submitted              : ${results.submitted}`,
    `accepted               : ${results.accepted}${results.idempotentReplays ? ` (${results.idempotentReplays} idempotent replays)` : ''}`,
    `rejected 429 (quota)   : ${results.rejected429}${results.retriedAfter429 ? ` (${results.retriedAfter429} retried after retry-after)` : ''}`,
    `rejected 413 (budget)  : ${results.rejected413}`,
    `errors                 : ${results.errors.length}`,
    Object.keys(results.rejectionReasons).length ? `429 reasons            : ${JSON.stringify(results.rejectionReasons)}` : null,
    Object.keys(results.byStatus).length ? `other statuses         : ${JSON.stringify(results.byStatus)}` : null,
    `submission throughput  : ${payload.submissionThroughputPerSecond ?? 'n/a'} req/s`,
    `submit latency p50/p95 : ${fmt(payload.submissionLatency, 'p50Ms')} / ${fmt(payload.submissionLatency, 'p95Ms')} ms`,
    '',
  ];

  if (outcomes.length) {
    lines.push(
      `terminal states        : ${JSON.stringify(byState)}`,
      `queue wait p50/p95     : ${fmt(payload.queueWait, 'p50Ms')} / ${fmt(payload.queueWait, 'p95Ms')} ms`,
      `render time p50/p95    : ${fmt(payload.renderTime, 'p50Ms')} / ${fmt(payload.renderTime, 'p95Ms')} ms`,
      `end-to-end p50/p95     : ${fmt(payload.endToEnd, 'p50Ms')} / ${fmt(payload.endToEnd, 'p95Ms')} ms`,
      `frames/sec p50/p95     : ${fmt(payload.framesPerSecond, 'p50Fps')} / ${fmt(payload.framesPerSecond, 'p95Fps')} (completed jobs only)`,
      '',
      'NOTE: boundaries are sampled by polling; error is up to one poll interval each.',
      '',
    );
    for (const outcome of outcomes.filter((item) => item.status !== 'complete').slice(0, 5)) {
      lines.push(`non-complete job ${outcome.jobId}: ${outcome.status}${outcome.error ? ` — ${outcome.error}` : ''}`);
    }
  } else {
    lines.push('polling skipped or no jobs accepted — no lifecycle timings collected.', '');
  }

  for (const [index, sample] of results.errors.slice(0, 5).entries()) {
    lines.push(`error sample ${index + 1}: [${sample.kind}] ${sample.message}`);
  }

  process.stdout.write(`${lines.filter((line) => line !== null).join('\n')}\n`);
  return payload;
}

async function main() {
  const values = parseCliArgs(process.argv.slice(2));
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!PRESETS.includes(values.preset)) throw new Error(`--preset must be one of: ${PRESETS.join(', ')}`);
  if (!FORMATS.includes(values.format)) throw new Error(`--format must be one of: ${FORMATS.join(', ')}`);
  if (!MODES.includes(values.mode)) throw new Error(`--mode must be one of: ${MODES.join(', ')}`);

  const duration = Number(values.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 180) {
    throw new Error('--duration must be between 1 and 180 seconds (VideoSpecSchema)');
  }
  const fps = positiveInt(values.fps, '--fps');
  if (fps > 60) throw new Error('--fps must be between 1 and 60 (VideoSpecSchema)');

  const options = {
    apiUrl: values['api-url'].replace(/\/+$/, ''),
    apiKey: values['api-key'],
    count: positiveInt(values.count, '--count'),
    concurrency: positiveInt(values.concurrency, '--concurrency'),
    duration,
    fps,
    preset: values.preset,
    format: values.format,
    mode: values.mode,
    viewMode: values['view-mode'],
    templateId: values['template-id'],
    rows: positiveInt(values.rows, '--rows'),
    timeout: positiveInt(values.timeout, '--timeout', { min: 100 }),
    pollInterval: positiveInt(values['poll-interval'], '--poll-interval', { min: 100 }),
    pollTimeout: positiveInt(values['poll-timeout'], '--poll-timeout', { min: 1_000 }),
    json: values.json,
    poll: !values['no-poll'],
    maxRetryAfterMs: 10_000,
    runId: randomUUID().slice(0, 8),
  };

  const budget = pixelBudget(options.preset, options.duration, options.fps);
  if (budget > MAX_PIXEL_BUDGET) {
    throw new Error(`spec exceeds MAX_PIXEL_BUDGET (${budget} > ${MAX_PIXEL_BUDGET}); lower --preset, --duration or --fps`);
  }

  const results = await runSubmissions(options);
  let outcomes = [];
  if (results.tracking.length > 0) {
    process.stderr.write(`awaiting ${results.tracking.length} in-flight video jobs (timeout ${options.pollTimeout} ms per job)...\n`);
    outcomes = await Promise.all(results.tracking);
  }
  report(options, results, outcomes);
}

if (process.argv[1]?.endsWith('submit-videos.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
