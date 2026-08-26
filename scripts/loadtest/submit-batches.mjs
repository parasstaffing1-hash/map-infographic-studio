#!/usr/bin/env node
/**
 * submit-batches.mjs — submission load test for POST /v1/render-jobs.
 *
 * What it measures: how the API behaves while accepting batch-render jobs —
 * submission throughput, submission latency percentiles, and how many requests
 * the per-key quota (BATCH_JOBS_PER_KEY_PER_HOUR) or the Fastify rate limiter
 * turns away with 429. It optionally polls batch status afterwards.
 *
 * What it does NOT measure: renderer throughput. Accepting a batch only enqueues
 * shard jobs; the actual rendering happens in the shard worker + renderer pool.
 * Treat "accepted" as "enqueued", never as "rendered".
 *
 * Zero dependencies: built-in fetch + node:util parseArgs only.
 */

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const HELP = `submit-batches.mjs — batch submission load test (POST /v1/render-jobs)

Options:
  --api-url <url>       Render platform base URL (default: http://127.0.0.1:8787)
  --api-key <key>       Bearer token, must be in API_KEYS (default: $LOADTEST_API_KEY
                        or "local-development-key")
  --count <n>           Number of batch jobs to submit (default: 20)
  --concurrency <n>     Concurrent in-flight submissions (default: 4)
  --rate <n>            Max submissions per second, 0 = unthrottled (default: 0)
  --shards <n>          manifest.shardCount per batch (default: 4)
  --records <n>         manifest.expectedRecords per batch (default: 100)
  --manifest <template> Manifest URL template, must contain {shard}
                        (default: http://127.0.0.1:8899/shards/{shard}.ndjson)
  --view-mode <mode>    viewMode for the batch (default: india)
  --template-id <id>    templateId for the batch (default: loadtest-batch)
  --width <n>           output.width  (default: 1920)
  --height <n>          output.height (default: 1080)
  --format <fmt>        output.format png|jpeg (default: png)
  --timeout <ms>        Per-request timeout in ms (default: 30000)
  --poll                After submitting, poll batch status to a terminal state
  --poll-interval <ms>  Status poll interval (default: 2000)
  --poll-timeout <ms>   Give up polling a batch after this long (default: 120000)
  --json                Emit the report as JSON instead of a text table
  -h, --help            Show this help

Notes:
  * 429 responses are counted, not fatal. retry-after is honoured once per
    request before the request is finally recorded as quota-rejected.
  * The manifest host must be reachable from the SHARD WORKER and its hostname
    must appear in MANIFEST_ALLOWED_HOSTS, otherwise shards fail after accept.
`;

const TERMINAL_BATCH = new Set(['complete', 'partial', 'failed', 'canceled']);

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'api-url': { type: 'string', default: process.env.LOADTEST_API_URL ?? 'http://127.0.0.1:8787' },
      'api-key': { type: 'string', default: process.env.LOADTEST_API_KEY ?? 'local-development-key' },
      count: { type: 'string', default: '20' },
      concurrency: { type: 'string', default: '4' },
      rate: { type: 'string', default: '0' },
      shards: { type: 'string', default: '4' },
      records: { type: 'string', default: '100' },
      manifest: { type: 'string', default: 'http://127.0.0.1:8899/shards/{shard}.ndjson' },
      'view-mode': { type: 'string', default: 'india' },
      'template-id': { type: 'string', default: 'loadtest-batch' },
      width: { type: 'string', default: '1920' },
      height: { type: 'string', default: '1080' },
      format: { type: 'string', default: 'png' },
      timeout: { type: 'string', default: '30000' },
      poll: { type: 'boolean', default: false },
      'poll-interval': { type: 'string', default: '2000' },
      'poll-timeout': { type: 'string', default: '120000' },
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

export function summarize(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    minMs: sorted.length ? Number(sorted[0].toFixed(1)) : null,
    p50Ms: sorted.length ? Number(percentile(sorted, 0.5).toFixed(1)) : null,
    p95Ms: sorted.length ? Number(percentile(sorted, 0.95).toFixed(1)) : null,
    p99Ms: sorted.length ? Number(percentile(sorted, 0.99).toFixed(1)) : null,
    maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(1)) : null,
  };
}

export function buildBatchRequest(options, index) {
  return {
    templateId: options.templateId,
    viewMode: options.viewMode,
    // Unique per submission so the idempotency short-circuit does not mask load.
    idempotencyKey: `loadtest-batch-${options.runId}-${index}`,
    manifest: {
      urlTemplate: options.manifest,
      shardCount: options.shards,
      expectedRecords: options.records,
    },
    output: {
      format: options.format,
      width: options.width,
      height: options.height,
      scale: 1,
      prefix: 'loadtest',
    },
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

/** One submission attempt. Never throws — every outcome is returned as data. */
async function submitOne(options, index, results) {
  const body = buildBatchRequest(options, index);
  let honouredRetryAfter = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = performance.now();
    let response;
    try {
      response = await fetch(`${options.apiUrl}/v1/render-jobs`, {
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
    results.latencies.push(elapsed);

    if (response.status === 429) {
      const payload = await readBody(response);
      const waitMs = retryAfterMs(response);
      // Honour retry-after once, but only if the wait is short enough to be
      // worth it; a fixed-window hourly quota can report thousands of seconds.
      if (!honouredRetryAfter && waitMs !== null && waitMs > 0 && waitMs <= options.maxRetryAfterMs) {
        honouredRetryAfter = true;
        results.retriedAfter429 += 1;
        await sleep(waitMs);
        continue;
      }
      results.rejected429 += 1;
      results.retryAfterSeconds.push(waitMs === null ? null : Math.round(waitMs / 1_000));
      if (payload && payload.error) results.rejectionReasons[payload.error] = (results.rejectionReasons[payload.error] ?? 0) + 1;
      else results.rejectionReasons.rate_limited = (results.rejectionReasons.rate_limited ?? 0) + 1;
      return;
    }

    if (response.status === 202 || response.status === 200) {
      const payload = await readBody(response);
      results.accepted += 1;
      if (response.status === 200) results.idempotentReplays += 1;
      if (payload && payload.batchId) results.batchIds.push(payload.batchId);
      return;
    }

    const payload = await readBody(response);
    results.errors.push({ index, kind: `http_${response.status}`, message: JSON.stringify(payload).slice(0, 300) });
    results.byStatus[response.status] = (results.byStatus[response.status] ?? 0) + 1;
    return;
  }
}

async function runSubmissions(options) {
  const results = {
    submitted: 0,
    accepted: 0,
    idempotentReplays: 0,
    rejected429: 0,
    retriedAfter429: 0,
    retryAfterSeconds: [],
    rejectionReasons: {},
    errors: [],
    byStatus: {},
    latencies: [],
    batchIds: [],
  };

  const minGapMs = options.rate > 0 ? 1_000 / options.rate : 0;
  let nextIndex = 0;
  let nextSlotAt = performance.now();
  const startedAt = performance.now();

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      if (index >= options.count) return;
      nextIndex += 1;
      if (minGapMs > 0) {
        const now = performance.now();
        const waitMs = Math.max(0, nextSlotAt - now);
        nextSlotAt = Math.max(now, nextSlotAt) + minGapMs;
        if (waitMs > 0) await sleep(waitMs);
      }
      results.submitted += 1;
      await submitOne(options, index, results);
    }
  };

  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.count) }, worker));
  results.wallClockMs = performance.now() - startedAt;
  return results;
}

async function pollBatch(options, batchId, deadline) {
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${options.apiUrl}/v1/render-jobs/${encodeURIComponent(batchId)}`, {
        headers: { authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(options.timeout),
      });
      if (response.status === 429) {
        await sleep(retryAfterMs(response) ?? options.pollInterval);
        continue;
      }
      if (response.ok) {
        const status = await readBody(response);
        if (status && TERMINAL_BATCH.has(status.status)) return status;
      }
    } catch {
      // Transient failures during polling are not fatal for the test run.
    }
    await sleep(options.pollInterval);
  }
  return { batchId, status: 'timeout' };
}

async function pollAll(options, batchIds) {
  const deadline = performance.now() + options.pollTimeout;
  const counts = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < batchIds.length) {
      const batchId = batchIds[cursor];
      cursor += 1;
      const status = await pollBatch(options, batchId, deadline);
      counts[status.status] = (counts[status.status] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, batchIds.length) }, worker));
  return counts;
}

function report(options, results, pollCounts) {
  const seconds = results.wallClockMs / 1_000;
  const latency = summarize(results.latencies);
  const payload = {
    target: `${options.apiUrl}/v1/render-jobs`,
    config: {
      count: options.count,
      concurrency: options.concurrency,
      rateLimitPerSecond: options.rate || null,
      shardsPerBatch: options.shards,
      expectedRecordsPerBatch: options.records,
      manifestTemplate: options.manifest,
    },
    submitted: results.submitted,
    accepted: results.accepted,
    idempotentReplays: results.idempotentReplays,
    rejectedByQuota429: results.rejected429,
    retriedAfterRetryAfter: results.retriedAfter429,
    rejectionReasons: results.rejectionReasons,
    errors: results.errors.length,
    errorSamples: results.errors.slice(0, 5),
    otherHttpStatuses: results.byStatus,
    wallClockSeconds: Number(seconds.toFixed(3)),
    submissionThroughputPerSecond: seconds > 0 ? Number((results.submitted / seconds).toFixed(2)) : null,
    acceptedThroughputPerSecond: seconds > 0 ? Number((results.accepted / seconds).toFixed(2)) : null,
    submissionLatency: latency,
    shardsEnqueued: results.accepted * options.shards,
    batchStatuses: pollCounts ?? null,
    caveat: 'Accepted means enqueued, not rendered. Shard/render throughput is not measured by this script.',
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  const lines = [
    '',
    '=== batch submission load test ===',
    `target                 : ${payload.target}`,
    `count / concurrency    : ${options.count} / ${options.concurrency}${options.rate ? ` @ ${options.rate}/s` : ''}`,
    `shards per batch       : ${options.shards} (expectedRecords ${options.records})`,
    '',
    `submitted              : ${results.submitted}`,
    `accepted (202/200)     : ${results.accepted}${results.idempotentReplays ? ` (${results.idempotentReplays} idempotent replays)` : ''}`,
    `rejected 429           : ${results.rejected429}${results.retriedAfter429 ? ` (${results.retriedAfter429} retried after retry-after)` : ''}`,
    `errors                 : ${results.errors.length}`,
    Object.keys(results.rejectionReasons).length ? `429 reasons            : ${JSON.stringify(results.rejectionReasons)}` : null,
    Object.keys(results.byStatus).length ? `other statuses         : ${JSON.stringify(results.byStatus)}` : null,
    '',
    `wall clock             : ${seconds.toFixed(2)} s`,
    `submission throughput  : ${payload.submissionThroughputPerSecond ?? 'n/a'} req/s`,
    `accepted throughput    : ${payload.acceptedThroughputPerSecond ?? 'n/a'} accepted/s`,
    `latency p50/p95/p99    : ${latency.p50Ms ?? 'n/a'} / ${latency.p95Ms ?? 'n/a'} / ${latency.p99Ms ?? 'n/a'} ms  (min ${latency.minMs ?? 'n/a'}, max ${latency.maxMs ?? 'n/a'})`,
    `shards enqueued        : ${payload.shardsEnqueued}`,
    pollCounts ? `batch end states       : ${JSON.stringify(pollCounts)}` : null,
    '',
    'NOTE: "accepted" == enqueued. This script does not measure render throughput.',
    '',
  ].filter((line) => line !== null);

  for (const [index, sample] of results.errors.slice(0, 5).entries()) {
    lines.push(`error sample ${index + 1}: [${sample.kind}] ${sample.message}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return payload;
}

async function main() {
  const values = parseCliArgs(process.argv.slice(2));
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!values.manifest.includes('{shard}')) {
    throw new Error('--manifest must contain the {shard} placeholder (BatchRenderRequestSchema requires it)');
  }
  if (!['png', 'jpeg'].includes(values.format)) {
    throw new Error('--format must be png or jpeg');
  }

  const options = {
    apiUrl: values['api-url'].replace(/\/+$/, ''),
    apiKey: values['api-key'],
    count: positiveInt(values.count, '--count'),
    concurrency: positiveInt(values.concurrency, '--concurrency'),
    rate: Number(values.rate) || 0,
    shards: positiveInt(values.shards, '--shards'),
    records: positiveInt(values.records, '--records'),
    manifest: values.manifest,
    viewMode: values['view-mode'],
    templateId: values['template-id'],
    width: positiveInt(values.width, '--width', { min: 320 }),
    height: positiveInt(values.height, '--height', { min: 320 }),
    format: values.format,
    timeout: positiveInt(values.timeout, '--timeout', { min: 100 }),
    pollInterval: positiveInt(values['poll-interval'], '--poll-interval', { min: 100 }),
    pollTimeout: positiveInt(values['poll-timeout'], '--poll-timeout', { min: 1_000 }),
    json: values.json,
    maxRetryAfterMs: 10_000,
    runId: randomUUID().slice(0, 8),
  };

  const results = await runSubmissions(options);
  let pollCounts = null;
  if (values.poll && results.batchIds.length > 0) {
    process.stderr.write(`polling ${results.batchIds.length} batches (timeout ${options.pollTimeout} ms)...\n`);
    pollCounts = await pollAll(options, results.batchIds);
  }
  report(options, results, pollCounts);
}

if (process.argv[1]?.endsWith('submit-batches.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
