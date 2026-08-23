import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { chromium, type Browser } from 'playwright-core';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { loadConfig } from './config.js';
import { RenderTaskSchema } from './contracts.js';
import { createObjectStore } from './storage.js';

function outputKey(prefix: string, batchId: string, name: string, format: 'png' | 'jpeg') {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  return [normalizedPrefix, batchId, `${name}.${format}`].filter(Boolean).join('/');
}

export async function buildRenderer() {
  const config = loadConfig();
  const app = Fastify({ logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] }, bodyLimit: 25 * 1_048_576, requestTimeout: config.RENDER_TIMEOUT_MS + 5_000 });
  const store = createObjectStore(config);
  let browser: Browser | undefined;
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'map_studio_renderer_' });
  const rendered = new Counter({ name: 'map_studio_renderer_outputs_total', help: 'Rendered infographic outputs', labelNames: ['format', 'outcome'], registers: [registry] });
  const duration = new Histogram({ name: 'map_studio_renderer_duration_seconds', help: 'Infographic render duration', buckets: [1, 2.5, 5, 10, 20, 45, 90], registers: [registry] });

  const getBrowser = async () => {
    if (!browser || !browser.isConnected()) browser = await chromium.launch({ headless: true, executablePath: config.CHROMIUM_EXECUTABLE_PATH, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
    return browser;
  };

  await app.register(helmet, { contentSecurityPolicy: false });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/ready' || request.url === '/metrics') return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token !== config.INTERNAL_RENDER_TOKEN) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/health', async () => ({ ok: true, service: 'map-studio-renderer' }));
  app.get('/ready', async (_request, reply) => {
    try { await getBrowser(); return { ok: true }; }
    catch (error) { return reply.code(503).send({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
  app.get('/metrics', async (_request, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  app.post('/v1/render', async (request, reply) => {
    const parsed = RenderTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    const task = parsed.data;
    const timer = duration.startTimer();
    const instance = await getBrowser();
    const context = await instance.newContext({ viewport: { width: task.output.width, height: task.output.height }, deviceScaleFactor: task.output.scale, colorScheme: 'light' });
    try {
      const page = await context.newPage();
      await page.addInitScript((project) => localStorage.setItem('map-studio-infographic-v1', JSON.stringify(project)), task.record.project);
      const target = new URL(config.WEB_APP_URL);
      target.searchParams.set('render', '1');
      target.searchParams.set('viewMode', task.viewMode);
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: config.RENDER_TIMEOUT_MS });
      const frame = page.locator('.map-frame');
      await frame.waitFor({ state: 'visible', timeout: config.RENDER_TIMEOUT_MS });
      await page.locator('.maplibregl-canvas').waitFor({ state: 'visible', timeout: config.RENDER_TIMEOUT_MS });
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
        return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
      }, undefined, { timeout: config.RENDER_TIMEOUT_MS });
      await page.waitForTimeout(1_000);
      const screenshot = await frame.screenshot(task.output.format === 'jpeg'
        ? { type: 'jpeg', quality: 92, animations: 'disabled' }
        : { type: 'png', animations: 'disabled' });
      const name = task.record.outputName ?? task.record.id;
      const key = outputKey(task.output.prefix, task.batchId, name, task.output.format);
      const uri = await store.put(key, screenshot, task.output.format === 'jpeg' ? 'image/jpeg' : 'image/png');
      rendered.inc({ format: task.output.format, outcome: 'success' });
      timer();
      return reply.code(201).send({ id: task.record.id, uri, key });
    } catch (error) {
      rendered.inc({ format: task.output.format, outcome: 'failure' });
      timer();
      request.log.error({ err: error, recordId: task.record.id }, 'render failed');
      return reply.code(500).send({ error: 'render_failed' });
    } finally {
      await context.close();
    }
  });

  app.addHook('onClose', async () => { if (browser) await browser.close(); });
  return { app, config };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, config } = await buildRenderer();
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ host: config.HOST, port: config.RENDERER_PORT });
}
